"""
Helper for writing to core.AdminActionLog from admin-facing actions.
"""

import json
import logging
from contextvars import ContextVar

from django.apps import apps
from django.db import transaction
from django.db.models import QuerySet
from django.db.models.signals import pre_delete
from django.core.serializers.json import DjangoJSONEncoder

from .models import AdminActionLog

logger = logging.getLogger(__name__)


def client_ip(request):
    # Render sits behind a proxy, so REMOTE_ADDR is always 127.0.0.1 there; the
    # first X-Forwarded-For hop is the real client.
    if request is None:
        return None
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '')
    if forwarded:
        return forwarded.split(',')[0].strip() or None
    return request.META.get('REMOTE_ADDR') or None


def _request_school_id(request, target):
    sid = getattr(request, 'tenant_school_id', None)
    if sid:
        return sid
    return getattr(target, 'school_id', None)


def log_admin_action(request, action, target, metadata=None, school_id=None):
    """
    Record one admin action for the audit trail.

    Originally super-admin-only actions (school/org management), now also
    used by school-level admins (e.g. SCHOOL_ADMIN/PRINCIPAL resetting a
    staff member's password) — `actor` just records whoever performed it.
    The feed itself (SuperAdminActionLogViewSet) stays Super-Admin-visible
    only; school admins don't get a UI for it yet.

    `target` is the model instance being acted on (e.g. a School, Organization,
    UserSchoolMembership, or User) — its class name, pk, and str() are captured
    so the log entry stays readable even after the target is later deleted.

    Who/where is captured from `request` (actor, client IP, user agent) and the
    school from `school_id`, the request's tenant, or `target.school_id`.
    """
    actor = getattr(request, 'user', None)
    return AdminActionLog.objects.create(
        actor=actor if actor and actor.is_authenticated else None,
        action=action,
        target_type=type(target).__name__,
        target_id=str(getattr(target, 'pk', '')),
        target_repr=str(target)[:255],
        metadata=metadata,
        school_id=school_id if school_id is not None else _request_school_id(request, target),
        ip_address=client_ip(request),
        user_agent=(request.META.get('HTTP_USER_AGENT', '') if request is not None else '')[:300],
    )


def snapshot_instance(instance):
    """JSON-safe copy of a row's own columns, taken before it is deleted."""
    data = {}
    for field in instance._meta.concrete_fields:
        data[field.attname] = getattr(instance, field.attname)
    return json.loads(json.dumps(data, cls=DjangoJSONEncoder))


def related_counts(instance):
    """How many rows hang off `instance` in each related table, so the log says
    exactly what a delete took with it (or detached)."""
    counts = {}
    for rel in instance._meta.related_objects:
        try:
            n = rel.related_model._base_manager.filter(**{rel.field.name: instance.pk}).count()
        except Exception:
            # A relation we can't count (custom manager, unmanaged table) must
            # never block the delete it is only describing.
            continue
        if n:
            counts[f'{rel.related_model._meta.label}.{rel.field.name}'] = n
    return counts


class AuditedDeleteMixin:
    """ModelViewSet mixin: every destroy() writes an AdminActionLog entry (who,
    when, IP, a snapshot of the row and counts of what it owned) in the same
    transaction as the delete, so there is never a delete without a record."""

    audit_delete_action = 'delete'

    def delete_instance(self, instance):
        """What a destroy actually does to the row; a viewset that soft-deletes
        overrides this (and audit_delete_action) instead of perform_destroy."""
        instance.delete()

    def perform_destroy(self, instance):
        with transaction.atomic():
            log_admin_action(
                self.request,
                self.audit_delete_action,
                instance,
                metadata={
                    'snapshot': snapshot_instance(instance),
                    'related_counts': related_counts(instance),
                },
            )
            self.delete_instance(instance)


# --- Audit every delete of business-critical models, whatever path it takes ---
#
# AuditedDeleteMixin only covers viewsets that opt in. A shell command, a repair
# script or a viewset nobody remembered to wrap would still erase rows with no
# trace, so the models below are also audited at the signal level.

# Models whose deletion is logged. A typo here fails app start-up on purpose (a
# silently unprotected model is worse than a loud error in tests).
AUDITED_DELETE_MODELS = [
    'students.Student', 'students.Class',
    'schools.School', 'schools.Organization',
    'examinations.ExamGroup', 'examinations.Exam', 'examinations.ExamSubject',
    'finance.Expense', 'finance.OtherIncome', 'finance.Transfer',
    'finance.FeePayment', 'finance.FeeStructure',
    'hr.StaffMember', 'hr.Payslip',
]

# Deleting these also deletes every mark entered under them, so their rows are
# copied into the log entry and a deleted exam can be rebuilt.
MARK_BACKUP_MODELS = {'examinations.Exam', 'examinations.ExamSubject', 'examinations.ExamGroup'}
MARK_BACKUP_CAP = 20000

_current_request = ContextVar('audit_current_request', default=None)


class AuditRequestMiddleware:
    """Remembers the request for the duration of the call so delete signals can
    say who did it and from where. Placed after authentication; the user is read
    lazily because DRF authenticates (JWT) after middleware has run."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = _current_request.set(request)
        try:
            return self.get_response(request)
        finally:
            _current_request.reset(token)


def _rows(queryset):
    return json.loads(json.dumps(list(queryset[:MARK_BACKUP_CAP].values()), cls=DjangoJSONEncoder))


def marks_backup(label, ids):
    """Marks (and, for an exam, its subjects) that deleting `ids` would erase."""
    from examinations.models import Exam, ExamSubject, StudentMark
    if label == 'examinations.ExamSubject':
        subjects = ExamSubject.objects.filter(pk__in=ids)
    elif label == 'examinations.Exam':
        subjects = ExamSubject.objects.filter(exam_id__in=ids)
    else:
        subjects = ExamSubject.objects.filter(exam__group_id__in=ids)
    marks = StudentMark.objects.filter(exam_subject__in=subjects)
    return {'exam_subjects': _rows(subjects), 'student_marks': _rows(marks),
            'student_marks_total': marks.count()}


def _audit_pre_delete(sender, instance, origin=None, **kwargs):
    label = sender._meta.label
    # `origin` is whatever started the delete. Rows removed only because a parent
    # went (cascade) are covered by the parent's entry and its related counts.
    if isinstance(origin, QuerySet):
        if origin.model is not sender or getattr(origin, '_audit_logged', False):
            return
        origin._audit_logged = True
        bulk = True
    elif origin is instance:
        bulk = False
    else:
        return

    try:
        request = _current_request.get()
        if bulk:
            ids = list(origin.values_list('pk', flat=True)[:500])
            metadata = {'bulk': True, 'count': origin.count(), 'ids_sample': ids,
                        'query': str(origin.query)[:2000]}
            target = instance
        else:
            ids = [instance.pk]
            metadata = {'snapshot': snapshot_instance(instance), 'related_counts': related_counts(instance)}
            target = instance
        if label in MARK_BACKUP_MODELS:
            metadata['marks_backup'] = marks_backup(label, ids)
        log_admin_action(request, 'hard_delete_bulk' if bulk else 'hard_delete', target, metadata=metadata)
    except Exception:
        # The audit trail must never be the reason a legitimate delete fails.
        logger.exception('Could not write delete audit entry for %s', label)


def register_delete_audit():
    for label in AUDITED_DELETE_MODELS:
        model = apps.get_model(label)
        pre_delete.connect(_audit_pre_delete, sender=model, weak=False, dispatch_uid=f'audit:delete:{label}')
