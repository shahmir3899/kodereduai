"""
Guards for students who have left the school (WITHDRAWN / TRANSFERRED).

A leaving date is the first day the student is gone: they were enrolled on
every day before it and on none from it. Attendance and marks were being
recorded for a student after they left (the withdrawal was entered late and
back-dated, 2026-09-24), so every attendance/marks writer checks this module,
and the Update Status action refuses a leaving date that would strand
existing records after it.

Only real departures count. A promoted enrollment is closed too but the
student is still at the school, so corrections to last year's marks for
promoted students stay allowed.
"""
from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Max, Min, Q
from django.utils import timezone

from students.status_groups import DEPARTED_STATUSES  # noqa: F401  (re-exported for existing importers)

from .models import StudentEnrollment


def enrolled_on_q(day, prefix=''):
    """Q on StudentEnrollment: in effect on ``day`` (active, or left after it, and
    not inside a break: a re-admitted student's enrollment is active again but
    they were away on the days of their EnrollmentBreak)."""
    from django.db.models import Exists, OuterRef

    from student_exits.models import EnrollmentBreak

    p = f'{prefix}__' if prefix else ''
    away = EnrollmentBreak.objects.filter(
        student_id=OuterRef(f'{p}student_id'), start_date__lte=day,
    ).filter(Q(end_date__isnull=True) | Q(end_date__gt=day))
    return (Q(**{f'{p}is_active': True}) | Q(**{f'{p}left_date__gt': day})) & ~Exists(away)


def _breaks_covering(school_id, student_ids, day):
    from student_exits.models import EnrollmentBreak

    return EnrollmentBreak.objects.filter(
        school_id=school_id, student_id__in=student_ids, start_date__lte=day,
    ).filter(Q(end_date__isnull=True) | Q(end_date__gt=day))


def left_by(school_id, student_ids, day):
    """{student_id: left_date} for students who had left by ``day``: their
    latest enrollment starting on or before ``day`` is a departure dated on or
    before it. The latest one, so a student who left and was later
    re-admitted isn't blocked by the old departure, and a day that falls
    outside every recorded year range is still checked.

    A student re-admitted since is still out for the days of their break: those
    map to the day the break started."""
    ids = [sid for sid in student_ids if sid]
    if not ids or not day:
        return {}
    latest = {}
    for sid, active, status, left in (
        StudentEnrollment.objects
        .filter(school_id=school_id, student_id__in=ids, academic_year__start_date__lte=day)
        .order_by('student_id', '-academic_year__start_date', '-is_active', '-id')
        .values_list('student_id', 'is_active', 'status', 'left_date')
    ):
        latest.setdefault(sid, (active, status, left))
    result = {
        sid: left for sid, (active, status, left) in latest.items()
        if not active and status in DEPARTED_STATUSES and left and left <= day
    }
    for sid, start in _breaks_covering(school_id, ids, day).values_list('student_id', 'start_date'):
        result.setdefault(sid, start)
    return result


def returns_after(school_id, student_ids, day):
    """{student_id: first day back} for students inside a closed break on ``day``,
    so a refusal can say when they return. Students still away are left out."""
    ids = [sid for sid in student_ids if sid]
    if not ids or not day:
        return {}
    return {
        sid: end
        for sid, end in _breaks_covering(school_id, ids, day)
        .filter(end_date__isnull=False).values_list('student_id', 'end_date')
    }


def departed_in_year(school_id, student_ids, academic_year_id):
    """{student_id: (status, left_date)} for students who left during
    ``academic_year_id``."""
    ids = [sid for sid in student_ids if sid]
    if not ids or not academic_year_id:
        return {}
    return {
        sid: (status, left)
        for sid, status, left in StudentEnrollment.objects.filter(
            school_id=school_id,
            student_id__in=ids,
            academic_year_id=academic_year_id,
            is_active=False,
            status__in=DEPARTED_STATUSES,
        ).values_list('student_id', 'status', 'left_date')
    }


def left_message(name, left_date, what='attendance', back_on=None):
    when = left_date.strftime('%d %b %Y') if left_date else 'an earlier date'
    if back_on:
        return (
            f"{name} was away from {when} until {back_on.strftime('%d %b %Y')}; "
            f"{what} can't be recorded for that period."
        )
    return f"{name} left the school on {when}; {what} can't be recorded on or after that date."


def departed_message(name, status, left_date):
    verb = 'transferred out' if status == 'TRANSFERRED' else 'withdrew'
    when = f" on {left_date.strftime('%d %b %Y')}" if left_date else ''
    return (
        f"{name} {verb}{when}, so marks can't be entered for them. "
        f"If this is wrong, set their status back to Active first."
    )


def _marks_on_or_after(student, day):
    from examinations.models import StudentMark

    return StudentMark.objects.filter(student=student).filter(
        Q(exam_subject__exam_date__gte=day)
        | Q(exam_subject__exam_date__isnull=True, exam_subject__exam__start_date__gte=day)
    )


def records_after_leaving(student, leaving_date):
    """Attendance and marks recorded on or after ``leaving_date``: what a
    withdrawal with that date would leave behind. Returns (attendance_qs,
    marks_qs, summary) where summary is the detail the Update Status screen
    shows, or None when nothing conflicts."""
    from attendance.models import AttendanceRecord

    attendance = AttendanceRecord.objects.filter(student=student, date__gte=leaving_date)
    marks = _marks_on_or_after(student, leaving_date).select_related('exam_subject__exam', 'exam_subject__subject')

    att = attendance.aggregate(
        count=Count('id'), first=Min('date'), last=Max('date'),
        present=Count('id', filter=Q(status='PRESENT')),
        absent=Count('id', filter=Q(status='ABSENT')),
        leave=Count('id', filter=Q(status='LEAVE')),
    )
    exams = {}
    last_exam_day = None
    for mark in marks:
        exam = mark.exam_subject.exam
        entry = exams.setdefault(exam.id, {'id': exam.id, 'name': exam.name, 'count': 0, 'entered': 0})
        entry['count'] += 1
        if mark.marks_obtained is not None or mark.is_absent:
            entry['entered'] += 1
        day = mark.exam_subject.exam_date or exam.start_date
        if day and (last_exam_day is None or day > last_exam_day):
            last_exam_day = day

    if not att['count'] and not exams:
        return attendance, marks, None

    last_day = max(d for d in (att['last'], last_exam_day) if d)
    summary = {
        'code': 'records_after_leaving',
        'student_id': student.id,
        'student_name': student.name,
        'leaving_date': leaving_date.isoformat(),
        'last_record_date': last_day.isoformat(),
        'suggested_leaving_date': (last_day + timedelta(days=1)).isoformat(),
        'attendance': {
            'count': att['count'],
            'first_date': att['first'].isoformat() if att['first'] else None,
            'last_date': att['last'].isoformat() if att['last'] else None,
            'present': att['present'],
            'absent': att['absent'],
            'leave': att['leave'],
        },
        'marks': {
            'count': sum(e['count'] for e in exams.values()),
            'exams': list(exams.values()),
        },
    }
    parts = []
    if att['count']:
        parts.append(
            f"{att['count']} attendance record{'s' if att['count'] != 1 else ''} "
            f"({summary['attendance']['first_date']} to {summary['attendance']['last_date']}, "
            f"{att['present']} present)"
        )
    if exams:
        parts.append(
            f"{summary['marks']['count']} exam mark{'s' if summary['marks']['count'] != 1 else ''} "
            f"in {', '.join(e['name'] for e in exams.values())}"
        )
    summary['detail'] = (
        f"{student.name} has {' and '.join(parts)} on or after {leaving_date.isoformat()}, "
        f"the leaving date you chose. Pick a leaving date after {summary['last_record_date']}, "
        f"or remove these records."
    )
    return attendance, marks, summary


def remove_records_after_leaving(student, leaving, request=None):
    """Delete attendance/marks on or after the leaving date, backed up in the
    admin audit log first so they can be restored."""
    from core.audit import log_admin_action

    attendance, marks, summary = records_after_leaving(student, leaving)
    if summary is None:
        return
    backup = {
        'leaving_date': leaving.isoformat(),
        'attendance': [
            {k: (v.isoformat() if hasattr(v, 'isoformat') else v) for k, v in row.items()}
            for row in attendance.values()
        ],
        'marks': [
            {k: (str(v) if v is not None and not isinstance(v, (int, bool, str)) else v) for k, v in row.items()}
            for row in marks.values()
        ],
    }
    log_admin_action(request, 'student_records_removed_after_leaving', student, metadata=backup)
    marks.delete()
    attendance.delete()


def sync_enrollment_status(student, previous_status, previous_date):
    """Bring the current year's enrollment in line with a status change.

    A student's Student.is_active/class_obj deliberately stay untouched (see the
    exam-results/report-card investigation: flipping those hides the student from
    their own PAST sessions, not just the current one). What changes is the
    CURRENT year's enrollment, the same mechanism that makes a graduate disappear
    from this year's rosters while staying visible in their own history.
    """
    from .models import AcademicYear

    new_status = student.status
    if new_status == previous_status:
        # Same departure, new date: the enrollment's leaving date follows,
        # or the rosters keep using the old one.
        if new_status in DEPARTED_STATUSES and student.status_date != previous_date:
            current_year = AcademicYear.objects.filter(school=student.school, is_current=True).first()
            if current_year and student.status_date:
                StudentEnrollment.objects.filter(
                    school=student.school, student=student, academic_year=current_year,
                    status__in=DEPARTED_STATUSES,
                ).update(left_date=student.status_date)
        return student

    went_departed = new_status in DEPARTED_STATUSES and previous_status not in DEPARTED_STATUSES
    came_back = new_status == 'ACTIVE' and previous_status in DEPARTED_STATUSES
    if not (went_departed or came_back):
        return student

    if went_departed:
        # Any route out records the start of the absence (the exit workflow does too).
        from student_exits.services import ensure_open_break

        ensure_open_break(student, student.status_date or timezone.now().date())

    if came_back:
        # However the student is reactivated, the months away are remembered and
        # their own login comes back (the Re-admit action does the same).
        from student_exits.services import activate_portal_login, close_break_on_return

        close_break_on_return(
            student, return_date=student.status_date or timezone.now().date(), previous_start=previous_date,
        )
        activate_portal_login(student)

    current_year = AcademicYear.objects.filter(school=student.school, is_current=True).first()
    if not current_year:
        return student

    enrollment = StudentEnrollment.objects.filter(
        school=student.school, student=student, academic_year=current_year,
    ).first()
    if not enrollment:
        return student

    if went_departed:
        enrollment.is_active = False
        enrollment.status = new_status
        # Falls back to today when no effective date was given, so the
        # enrollment_covers_month() cutoff still lands somewhere sensible
        # (a null left_date would exclude every month, including this one).
        enrollment.left_date = student.status_date or timezone.now().date()
    else:
        enrollment.is_active = True
        enrollment.status = 'ACTIVE'
        enrollment.left_date = None
    enrollment.save(update_fields=['is_active', 'status', 'left_date', 'updated_at'])
    return student


def apply_departure(student, status, leaving_date, reason='', *, remove_records=False, request=None):
    """Mark a student as departed (WITHDRAWN/TRANSFERRED) and close this year's
    enrollment. Used by the exit workflow; the Update Status serializer applies
    the same two steps for its own status changes."""
    previous_status, previous_date = student.status, student.status_date
    with transaction.atomic():
        if remove_records:
            remove_records_after_leaving(student, leaving_date, request)
        student.status = status
        student.status_date = leaving_date
        student.status_reason = reason or ''
        student.save(update_fields=['status', 'status_date', 'status_reason', 'updated_at'])
        sync_enrollment_status(student, previous_status, previous_date)
    return student
