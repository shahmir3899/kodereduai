"""Manual re-numbering of a section's roll numbers (admin tool, any time).

Roll numbers are never shifted automatically: they appear on registers, report cards
and fee slips, so closing a gap is a deliberate act with a preview. Only active
enrollments are numbered; students who left keep the number in their closed record.
"""
from django.db import transaction

from .enrollment_service import move_student
from .models import StudentEnrollment

ORDERS = ('alphabetical', 'roll', 'admission', 'manual')


class RenumberError(Exception):
    pass


def _sort_key(order):
    def numeric(roll):
        text = str(roll or '').strip()
        return (0, int(text), '') if text.isdigit() else (1, 0, text)

    if order == 'roll':
        return lambda e: (numeric(e.roll_number), e.student.name.lower(), e.id)
    if order == 'admission':
        return lambda e: (e.student.admission_date is None, e.student.admission_date or 0, e.student.name.lower(), e.id)
    return lambda e: (e.student.name.lower(), e.id)


def _section_enrollments(session_class):
    return list(
        StudentEnrollment.objects.filter(
            school_id=session_class.school_id, academic_year_id=session_class.academic_year_id,
            session_class=session_class, is_active=True,
        ).select_related('student')
    )


def build_plan(session_class, order='alphabetical', manual_ids=None):
    """[{enrollment_id, student_id, name, old_roll, new_roll}] numbering 1..n."""
    if order not in ORDERS:
        raise RenumberError('Choose how to order the students.')
    enrollments = _section_enrollments(session_class)
    if order == 'manual':
        by_student = {e.student_id: e for e in enrollments}
        ids = [int(i) for i in (manual_ids or [])]
        if sorted(ids) != sorted(by_student):
            raise RenumberError('The manual order must list every student in the section exactly once.')
        ordered = [by_student[i] for i in ids]
    else:
        ordered = sorted(enrollments, key=_sort_key(order))
    return [
        {
            'enrollment_id': e.id, 'student_id': e.student_id, 'name': e.student.name,
            'old_roll': e.roll_number, 'new_roll': str(position),
        }
        for position, e in enumerate(ordered, start=1)
    ]


def attendance_warning(session_class, plan):
    """How many attendance rows this year belong to the students being renumbered."""
    from attendance.models import AttendanceRecord

    return AttendanceRecord.objects.filter(
        school_id=session_class.school_id, academic_year_id=session_class.academic_year_id,
        student_id__in=[row['student_id'] for row in plan],
    ).count()


@transaction.atomic
def apply_plan(session_class, plan, user=None, request=None):
    """Write the plan in one transaction. The unique roll constraint is checked per
    statement, so changed rows first move to a unique temporary roll, then to their final one."""
    from core.audit import log_admin_action

    changed = [row for row in plan if row['old_roll'] != row['new_roll']]
    if not changed:
        return []
    enrollments = {
        e.id: e for e in StudentEnrollment.objects.select_for_update().filter(
            id__in=[row['enrollment_id'] for row in changed], session_class=session_class, is_active=True,
        ).select_related('student')
    }
    if len(enrollments) != len(changed):
        raise RenumberError('The section changed since the preview. Preview again.')
    for row in changed:
        if enrollments[row['enrollment_id']].roll_number != row['old_roll']:
            raise RenumberError('A roll number changed since the preview. Preview again.')

    for enrollment in enrollments.values():
        StudentEnrollment.objects.filter(pk=enrollment.pk).update(roll_number=f'~{enrollment.pk}')
    for row in changed:
        enrollment = enrollments[row['enrollment_id']]
        enrollment.roll_number = f'~{enrollment.pk}'
        move_student(enrollment, roll_number=row['new_roll'])

    if request is not None:
        log_admin_action(request, 'section_renumbered', session_class, metadata={
            'changes': [{k: row[k] for k in ('student_id', 'old_roll', 'new_roll')} for row in changed],
        })
    return changed
