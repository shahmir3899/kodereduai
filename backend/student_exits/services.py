"""Student exit workflow: open a case, compute and waive clearance, finalize or cancel.

Views stay thin and call these. Everything that changes data on finalize runs in
one transaction, so a failure part-way leaves the student untouched.
"""
from datetime import date as date_cls
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from academic_sessions.leaving import (
    DEPARTED_STATUSES, apply_departure, records_after_leaving,
)
from core.audit import log_admin_action
from finance.student_balance import student_pending_fees

from .models import ExitClearanceItem, StudentExit

WAIVER_REASON_MIN_LENGTH = 10
Kind = ExitClearanceItem.Kind
State = ExitClearanceItem.State


class ExitError(Exception):
    """A rule of the workflow was broken; `message` is safe to show the user and
    `payload` (optional) is the structured body for the API response."""

    def __init__(self, message, payload=None):
        super().__init__(message)
        self.message = message
        self.payload = payload or {'detail': message}


class RecordsAfterLeaving(ExitError):
    """The chosen leaving date would strand attendance/marks recorded after it.
    The payload is the same summary the Update Status dialog already renders."""


class ClearanceIncomplete(ExitError):
    def __init__(self, items):
        names = ', '.join(i.get_kind_display().lower() for i in items)
        super().__init__(
            f'Clear or waive every open item before finalizing: {names}.',
            {
                'code': 'clearance_incomplete',
                'detail': f'Clear or waive every open item before finalizing: {names}.',
                'open_items': [i.kind for i in items],
            },
        )


# ── Clearance ────────────────────────────────────────────────────────────────

def _money(value):
    return f'{Decimal(value):,.2f}'.rstrip('0').rstrip('.')


def _fees_check(student):
    pending = student_pending_fees(student)
    total = pending['total']
    if total <= 0:
        return None
    return {
        'summary': f'PKR {_money(total)} pending',
        'amount': total,
        'fingerprint': f'{total:.2f}',
        'detail': {
            'items': [
                {
                    'label': i['label'], 'fee_type': i['fee_type'],
                    'month': i['month'], 'year': i['year'], 'balance': str(i['balance']),
                }
                for i in pending['items']
            ],
        },
    }


def _library_check(student):
    from library.models import BookIssue

    issues = list(
        BookIssue.objects.filter(student=student, status__in=['ISSUED', 'OVERDUE'])
        .select_related('book').order_by('due_date', 'id')
    )
    if not issues:
        return None
    return {
        'summary': f'{len(issues)} book{"s" if len(issues) != 1 else ""} not returned',
        'amount': None,
        'fingerprint': ','.join(str(i.id) for i in issues),
        'detail': {
            'books': [
                {'id': i.id, 'title': getattr(i.book, 'title', str(i.book)), 'due_date': i.due_date.isoformat(),
                 'status': i.status}
                for i in issues
            ],
        },
    }


def _gate_pass_check(student):
    """Only a student who is out right now (checked out, not yet back) blocks an
    exit; passes that were never used are expired automatically on finalize."""
    from hostel.models import GatePass

    passes = list(GatePass.objects.filter(student=student, status='USED', actual_return__isnull=True).order_by('id'))
    if not passes:
        return None
    return {
        'summary': f'{len(passes)} gate pass{"es" if len(passes) != 1 else ""} still out',
        'amount': None,
        'fingerprint': ','.join(str(p.id) for p in passes),
        'detail': {
            'passes': [
                {'id': p.id, 'going_to': p.going_to, 'departure_date': p.departure_date.isoformat()}
                for p in passes
            ],
        },
    }


CHECKS = {
    Kind.FEES: _fees_check,
    Kind.LIBRARY: _library_check,
    Kind.GATE_PASS: _gate_pass_check,
}


def refresh_clearance(exit_case):
    """Recompute every item from live data. A waiver survives only while the
    situation it was granted for is unchanged."""
    existing = {item.kind: item for item in exit_case.items.all()}
    for kind, check in CHECKS.items():
        result = check(exit_case.student)
        item = existing.get(kind) or ExitClearanceItem(exit=exit_case, kind=kind)

        if result is None:
            item.state = State.CLEAR
            item.summary = ''
            item.detail = {}
            item.amount = None
            item.waived_fingerprint = ''
        else:
            still_waived = (
                item.state == State.WAIVED and item.waived_fingerprint == result['fingerprint']
            )
            item.summary = result['summary']
            item.detail = result['detail']
            item.amount = result['amount']
            if still_waived:
                item.state = State.WAIVED
            else:
                item.state = State.OPEN
                item.waived_fingerprint = ''
                item.waiver_reason = ''
                item.waived_by = None
                item.waived_at = None
        item.save()
    return list(exit_case.items.all())


def _current_fingerprint(student, kind):
    result = CHECKS[kind](student)
    return result['fingerprint'] if result else None


def waive_item(exit_case, kind, reason, user):
    _require_open(exit_case)
    reason = (reason or '').strip()
    if len(reason) < WAIVER_REASON_MIN_LENGTH:
        raise ExitError(f'Give a reason of at least {WAIVER_REASON_MIN_LENGTH} characters to waive this item.')
    refresh_clearance(exit_case)
    item = exit_case.items.get(kind=kind)
    if item.state == State.CLEAR:
        raise ExitError('Nothing to waive: this item is already clear.')
    item.state = State.WAIVED
    item.waiver_reason = reason
    item.waived_by = user
    item.waived_at = timezone.now()
    item.waived_fingerprint = _current_fingerprint(exit_case.student, kind) or ''
    item.save()
    return item


def unwaive_item(exit_case, kind):
    _require_open(exit_case)
    item = exit_case.items.get(kind=kind)
    if item.state != State.WAIVED:
        raise ExitError('This item is not waived.')
    item.state = State.OPEN
    item.waived_fingerprint = ''
    item.waiver_reason = ''
    item.waived_by = None
    item.waived_at = None
    item.save()
    return item


# ── Lifecycle ────────────────────────────────────────────────────────────────

def _require_open(exit_case):
    if exit_case.status != StudentExit.Status.OPEN:
        raise ExitError('This exit is no longer open.')


def _check_destination(school, exit_type, destination):
    if exit_type == StudentExit.ExitType.TRANSFERRED:
        if destination is None:
            raise ExitError('Choose the branch the student is transferring to.')
        if destination.id == school.id:
            raise ExitError('The destination must be a different school.')
        if not school.organization_id or destination.organization_id != school.organization_id:
            raise ExitError('A student can only be transferred to another school of the same organization.')
        if not destination.is_active:
            raise ExitError('The destination school is not active.')
    elif destination is not None:
        raise ExitError('A destination school applies only to transfers.')


def _check_leaving_records(student, leaving_date, remove_records):
    if remove_records:
        return
    _attendance, _marks, summary = records_after_leaving(student, leaving_date)
    if summary is not None:
        raise RecordsAfterLeaving(summary['detail'], summary)


def open_exit(*, student, exit_type, leaving_date, reason='', destination_school=None,
              remove_records=False, user=None):
    if student.status in DEPARTED_STATUSES:
        raise ExitError(f'{student.name} has already left. Re-admit them before starting another exit.')
    if StudentExit.objects.filter(student=student, status=StudentExit.Status.OPEN).exists():
        raise ExitError(f'{student.name} already has an exit in progress.')
    if not isinstance(leaving_date, date_cls):
        raise ExitError('A leaving date is required.')
    _check_destination(student.school, exit_type, destination_school)
    _check_leaving_records(student, leaving_date, remove_records)

    with transaction.atomic():
        exit_case = StudentExit.objects.create(
            school=student.school, student=student, exit_type=exit_type,
            leaving_date=leaving_date, reason=reason or '',
            destination_school=destination_school,
            remove_records_after_leaving=remove_records, requested_by=user,
        )
        refresh_clearance(exit_case)
    return exit_case


def update_exit(exit_case, *, leaving_date=None, reason=None, destination_school=None,
                destination_given=False, remove_records=None):
    _require_open(exit_case)
    new_date = leaving_date or exit_case.leaving_date
    new_remove = exit_case.remove_records_after_leaving if remove_records is None else remove_records
    new_destination = destination_school if destination_given else exit_case.destination_school
    _check_destination(exit_case.school, exit_case.exit_type, new_destination)
    _check_leaving_records(exit_case.student, new_date, new_remove)

    exit_case.leaving_date = new_date
    exit_case.remove_records_after_leaving = new_remove
    exit_case.destination_school = new_destination
    if reason is not None:
        exit_case.reason = reason
    exit_case.save()
    return exit_case


def _deactivate_portal_login(student):
    """Turn off the student's own login at this school. Only the membership is
    deactivated: the user may hold other roles. Parent links are left alone, so
    parents keep (read-only) access to the history."""
    from schools.models import UserSchoolMembership

    profile = getattr(student, 'user_profile', None)
    if profile is None:
        return 0
    return UserSchoolMembership.objects.filter(
        user_id=profile.user_id, school_id=student.school_id, is_active=True,
    ).update(is_active=False)


def _close_school_services(student, leaving_date):
    from hostel.models import GatePass, HostelAllocation
    from transport.models import TransportAssignment

    HostelAllocation.objects.filter(student=student, is_active=True).update(
        is_active=False, vacated_date=leaving_date,
    )
    TransportAssignment.objects.filter(student=student, is_active=True).update(is_active=False)
    GatePass.objects.filter(student=student, status__in=['PENDING', 'APPROVED']).update(status='EXPIRED')


def _snapshot(exit_case, items):
    student = exit_case.student
    return {
        'class_name': getattr(student.class_obj, 'name', None),
        'roll_number': student.roll_number,
        'pending_fees': str(student_pending_fees(student)['total']),
        'clearance': [
            {
                'kind': i.kind, 'state': i.state, 'summary': i.summary,
                'amount': str(i.amount) if i.amount is not None else None,
                'waiver_reason': i.waiver_reason,
                'waived_by': getattr(i.waived_by, 'username', None),
                'waived_at': i.waived_at.isoformat() if i.waived_at else None,
            }
            for i in items
        ],
    }


def finalize_exit(exit_case, user, request=None):
    with transaction.atomic():
        exit_case = StudentExit.objects.select_for_update().get(pk=exit_case.pk)
        _require_open(exit_case)
        student = exit_case.student

        items = refresh_clearance(exit_case)
        blocking = [i for i in items if i.state == State.OPEN]
        if blocking:
            raise ClearanceIncomplete(blocking)
        _check_leaving_records(student, exit_case.leaving_date, exit_case.remove_records_after_leaving)

        apply_departure(
            student, exit_case.exit_type, exit_case.leaving_date, exit_case.reason,
            remove_records=exit_case.remove_records_after_leaving, request=request,
        )
        _close_school_services(student, exit_case.leaving_date)
        _deactivate_portal_login(student)

        exit_case.snapshot = _snapshot(exit_case, items)
        exit_case.status = StudentExit.Status.FINALIZED
        exit_case.finalized_by = user
        exit_case.finalized_at = timezone.now()
        exit_case.save()

        log_admin_action(request, 'student_exit_finalized', student, metadata={
            'exit_id': exit_case.id,
            'exit_type': exit_case.exit_type,
            'leaving_date': exit_case.leaving_date.isoformat(),
            'destination_school_id': exit_case.destination_school_id,
            'clearance': exit_case.snapshot['clearance'],
        })
    return exit_case


def cancel_exit(exit_case, user, reason='', request=None):
    _require_open(exit_case)
    exit_case.status = StudentExit.Status.CANCELLED
    exit_case.cancelled_by = user
    exit_case.cancelled_at = timezone.now()
    exit_case.cancel_reason = (reason or '').strip()
    exit_case.save()
    log_admin_action(request, 'student_exit_cancelled', exit_case.student, metadata={
        'exit_id': exit_case.id, 'reason': exit_case.cancel_reason,
    })
    return exit_case
