"""Rules for taking a student off the roll: what counts as history, and which
outcomes are open to them.

A student with no records of any kind can be erased for real; one with history
is only ever marked left/transferred/graduated/repeat or soft-deleted, because a
hard delete cascades away their attendance, fees and marks (student 706,
2026-10-08).
"""
from .status_groups import DEPARTED_STATUSES

# Related tables that are created for every student and say nothing about their
# time at school, so they do not make a student "have history".
IGNORED_RELATIONS = frozenset({
    'notifications.NotificationPreference.student',
    # One is created with every enrollment; a class move adds more and is caught below.
    'academic_sessions.EnrollmentPlacement.student',
})

# Buckets shown to the admin; anything else is reported under 'other'.
_GROUPS = {
    'attendance': ('attendance.AttendanceRecord',),
    'fees': ('finance.FeePayment', 'finance.OnlinePayment', 'finance.StudentDiscount', 'finance.FeeStructure'),
    'marks': ('examinations.StudentMark', 'examinations.StudentTermAssessment', 'examinations.StudentResponse'),
    'enrollments': ('academic_sessions.StudentEnrollment',),
}


def _group_for(label):
    model_label = label.rsplit('.', 1)[0]
    for group, labels in _GROUPS.items():
        if model_label in labels:
            return group
    return 'other'


def _only_the_auto_created_enrollment(student):
    """True when the student's single enrollment is the one creating them makes."""
    rows = list(student.enrollments.values_list('status', 'left_date')[:2])
    return (
        len(rows) == 1 and rows[0][0] == 'ACTIVE' and rows[0][1] is None
        and student.enrollment_placements.count() <= 1
    )


def history_counts(student):
    """{'<app.Model.field>': n} for every related table that holds rows for them."""
    from django.db import connection

    # One UNION ALL round trip instead of ~45 count queries: against the remote
    # database each query costs a network hop and the dialog took ~14 s to open.
    parts, params, keys = [], [], []
    for rel in student._meta.related_objects:
        key = f'{rel.related_model._meta.label}.{rel.field.name}'
        if key in IGNORED_RELATIONS:
            continue
        sql, sql_params = (
            rel.related_model._base_manager.filter(**{rel.field.name: student.pk}).values('pk').query.sql_with_params()
        )
        parts.append(f'SELECT %s AS k, COUNT(*) AS n FROM ({sql}) AS t')
        params += [key, *sql_params]
        keys.append(key)
    counts = {}
    if parts:
        with connection.cursor() as cursor:
            cursor.execute(' UNION ALL '.join(parts), params)
            counts = {key: n for key, n in cursor.fetchall() if n}
    enrollment_key = 'academic_sessions.StudentEnrollment.student'
    if counts.get(enrollment_key) == 1 and _only_the_auto_created_enrollment(student):
        del counts[enrollment_key]
    return counts


def student_has_history(student):
    return bool(history_counts(student))


def removal_preview(student):
    """What the Status & exit dialog needs: the records the student owns, grouped,
    and the outcomes an admin can pick for them."""
    counts = history_counts(student)
    grouped = {group: 0 for group in (*_GROUPS, 'other')}
    for key, n in counts.items():
        grouped[_group_for(key)] += n

    outcomes = []
    if student.status in DEPARTED_STATUSES:
        outcomes.append('READMIT')
    else:
        outcomes += ['LEFT', 'TRANSFERRED']
    if student.status != 'GRADUATED':
        outcomes.append('GRADUATED')
    if student.status != 'REPEAT':
        outcomes.append('REPEAT')
    outcomes.append('REMOVE')

    return {
        'has_history': bool(counts),
        'counts': grouped,
        'detail': counts,
        'allowed_outcomes': outcomes,
        'can_purge': not counts,
    }


class OutcomeError(Exception):
    """A Graduated/Repeat change that cannot be made; ``payload`` is the API body."""

    def __init__(self, detail, code='outcome_refused'):
        super().__init__(detail)
        self.payload = {'code': code, 'detail': detail}


def _next_year(school_id, year):
    from academic_sessions.models import AcademicYear

    return (
        AcademicYear.objects.filter(school_id=school_id, start_date__gt=year.start_date)
        .order_by('start_date').first()
    )


def _records_in_year(student, year):
    """Attendance or fees already recorded for a later year's enrollment: closing
    that enrollment would hide them, so the outcome is refused instead."""
    from attendance.models import AttendanceRecord
    from finance.models import FeePayment

    return (
        AttendanceRecord.objects.filter(student=student, academic_year=year).exists()
        or FeePayment.objects.filter(student=student, academic_year=year).exists()
    )


def set_academic_outcome(*, student, outcome, reason, user, request=None, academic_year=None):
    """Mark a student Graduated or Repeat for a year, as the one manual writer.

    Enrollment status is what year-scoped lists read (so an older session still
    shows graduates), and Student.status is kept in step, as promotion does.
    When the next year already has an enrollment for them (bulk promotion has
    run), or Repeat needs one, the promotion correction code does the work so a
    graduate can come back to repeat and a promoted student can still graduate.
    """
    from django.db import transaction

    from academic_sessions.models import (
        AcademicYear, PromotionEvent, PromotionOperation, StudentEnrollment,
    )
    from academic_sessions.views import StudentEnrollmentViewSet
    from core.audit import log_admin_action

    outcome = (outcome or '').upper()
    if outcome not in ('GRADUATED', 'REPEAT'):
        raise OutcomeError('Choose Graduated or Repeat.', 'bad_outcome')
    reason = (reason or '').strip()
    if not reason:
        raise OutcomeError('A reason is required.', 'reason_required')
    if student.status in DEPARTED_STATUSES:
        raise OutcomeError(
            f'{student.name} has left the school. Re-admit them before changing their outcome.', 'student_departed',
        )

    year = academic_year or AcademicYear.objects.filter(school_id=student.school_id, is_current=True).first()
    if year is None or year.school_id != student.school_id:
        raise OutcomeError('There is no academic year to apply this to.', 'no_year')
    enrollment = StudentEnrollment.objects.filter(student=student, academic_year=year).first()
    if enrollment is None:
        raise OutcomeError(f'{student.name} has no enrollment in {year.name}.', 'no_enrollment')

    later = (
        StudentEnrollment.objects.filter(student=student, academic_year__start_date__gt=year.start_date)
        .select_related('academic_year').order_by('academic_year__start_date').first()
    )
    target_year = later.academic_year if later else _next_year(student.school_id, year)
    if later is not None and _records_in_year(student, later.academic_year):
        raise OutcomeError(
            f'{student.name} already has attendance or fees in {later.academic_year.name}, '
            'so that year cannot be undone here.', 'later_year_has_records',
        )

    previous = enrollment.status
    with transaction.atomic():
        operation = PromotionOperation.objects.create(
            school_id=student.school_id, source_academic_year=year, target_academic_year=target_year or year,
            operation_type=PromotionOperation.OperationType.SINGLE_CORRECTION, total_students=1,
            reason=reason, initiated_by=user if getattr(user, 'is_authenticated', False) else None,
            metadata={'source': 'students.outcome'},
        )
        if target_year is not None and (later is not None or outcome == 'REPEAT'):
            result = StudentEnrollmentViewSet()._run_single_correction(
                school_id=student.school_id, source_year=year, target_year=target_year,
                correction={
                    'student_id': student.id, 'reason': reason,
                    'action': 'GRADUATE' if outcome == 'GRADUATED' else 'REPEAT',
                },
                operation=operation, request_user=user,
            )
            if not result.get('ok'):
                raise OutcomeError(result.get('reason') or 'The change could not be applied.', 'correction_failed')
        else:
            # No next year to place them in (or nothing to undo): flag it in place.
            enrollment.status = (
                StudentEnrollment.Status.GRADUATED if outcome == 'GRADUATED' else StudentEnrollment.Status.REPEAT
            )
            enrollment.save(update_fields=['status', 'updated_at'])
            student.status = outcome
            student.save(update_fields=['status', 'updated_at'])
            StudentEnrollmentViewSet._log_promotion_event(
                operation=operation, school_id=student.school_id, created_by=user, student_id=student.id,
                event_type=(
                    PromotionEvent.EventType.GRADUATED if outcome == 'GRADUATED'
                    else PromotionEvent.EventType.REPEATED
                ),
                source_enrollment=enrollment, source_year_id=year.id, target_year_id=year.id,
                source_class_id=enrollment.class_obj_id, source_session_class_id=enrollment.session_class_id,
                old_status=previous, new_status=enrollment.status,
                old_roll=enrollment.roll_number, new_roll=enrollment.roll_number, reason=reason,
                details={'phase': 'manual_in_place'},
            )
        if request is not None:
            log_admin_action(request, 'student_outcome', student, metadata={
                'outcome': outcome, 'academic_year': year.id, 'previous_status': previous, 'reason': reason,
            })
    student.refresh_from_db()
    return student
