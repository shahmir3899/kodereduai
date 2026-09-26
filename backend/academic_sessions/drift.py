"""
Checks that a student's class placement agrees with itself.

Shared by the `report_enrollment_drift` command (on demand) and the nightly
`check_enrollment_drift` task (which notifies admins), so both flag exactly the
same rows.

The Student.class_obj/roll_number snapshot means the student's *latest*
placement: promotion moves it to the next year's class straight away, before
that year becomes current (kept deliberately, 2026-09-25). So the snapshot is
compared with the student's latest enrollment, not the current year's.
"""
from django.db.models import Exists, F, OuterRef, Subquery

from .models import SessionClass, StudentEnrollment


def drift_checks(school_id=None, academic_year_id=None):
    """[(key, title, queryset of StudentEnrollment)] -- every queryset empty = no drift."""
    active = StudentEnrollment.objects.filter(is_active=True)
    if school_id:
        active = active.filter(school_id=school_id)
    if academic_year_id:
        active = active.filter(academic_year_id=academic_year_id)
    active = active.select_related('student', 'class_obj', 'session_class', 'academic_year')

    latest_for_student = (
        StudentEnrollment.objects
        .filter(student_id=OuterRef('student_id'))
        .order_by('-academic_year__start_date', '-is_active', '-id')
        .values('pk')[:1]
    )
    from attendance.models import AttendanceRecord
    from examinations.models import StudentMark
    from .leaving import DEPARTED_STATUSES

    departed = StudentEnrollment.objects.filter(
        is_active=False, status__in=DEPARTED_STATUSES, left_date__isnull=False,
    )
    if school_id:
        departed = departed.filter(school_id=school_id)
    if academic_year_id:
        departed = departed.filter(academic_year_id=academic_year_id)
    departed = departed.select_related('student', 'class_obj', 'session_class', 'academic_year')

    latest = StudentEnrollment.objects.filter(pk=Subquery(latest_for_student), student__is_active=True)
    if school_id:
        latest = latest.filter(school_id=school_id)
    latest = latest.select_related('student', 'class_obj', 'session_class', 'academic_year')

    return [
        (
            'section_mismatch',
            'class_obj disagrees with session_class master',
            active.filter(session_class__class_obj__isnull=False)
            .exclude(session_class__class_obj_id=F('class_obj_id')),
        ),
        (
            # Only where the class has sections that year: a school or year
            # that doesn't use sections isn't "unassigned", and would
            # otherwise be alerted every night.
            'no_section',
            'no session_class (unassigned section)',
            active.filter(session_class__isnull=True).filter(Exists(
                SessionClass.objects.filter(
                    school_id=OuterRef('school_id'), academic_year_id=OuterRef('academic_year_id'),
                    class_obj_id=OuterRef('class_obj_id'), is_active=True,
                )
            )),
        ),
        (
            'orphan_section',
            'session_class not linked to a master class (orphan)',
            active.filter(session_class__isnull=False, session_class__class_obj__isnull=True),
        ),
        (
            # A withdrawal entered late and back-dated left three weeks of
            # attendance and an exam's marks after the leaving date.
            'records_after_leaving',
            'Attendance or marks recorded on/after the student left',
            departed.filter(
                Exists(AttendanceRecord.objects.filter(
                    student_id=OuterRef('student_id'), date__gte=OuterRef('left_date'),
                ))
                | Exists(StudentMark.objects.filter(
                    student_id=OuterRef('student_id'),
                    exam_subject__exam__academic_year_id=OuterRef('academic_year_id'),
                    exam_subject__exam__start_date__gte=OuterRef('left_date'),
                ))
            ),
        ),
        (
            'snapshot_mismatch',
            'Student snapshot disagrees with the latest enrollment',
            latest.exclude(
                student__class_obj_id=F('class_obj_id'),
                student__roll_number=F('roll_number'),
            ),
        ),
    ]
