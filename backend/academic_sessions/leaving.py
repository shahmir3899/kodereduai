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

from django.db.models import Count, Max, Min, Q

from .models import StudentEnrollment

DEPARTED_STATUSES = ('WITHDRAWN', 'TRANSFERRED')


def enrolled_on_q(day, prefix=''):
    """Q on StudentEnrollment: in effect on ``day`` (active, or left after it)."""
    p = f'{prefix}__' if prefix else ''
    return Q(**{f'{p}is_active': True}) | Q(**{f'{p}left_date__gt': day})


def left_by(school_id, student_ids, day):
    """{student_id: left_date} for students who had left by ``day``: their
    latest enrollment starting on or before ``day`` is a departure dated on or
    before it. The latest one, so a student who left and was later
    re-admitted isn't blocked by the old departure, and a day that falls
    outside every recorded year range is still checked."""
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
    return {
        sid: left for sid, (active, status, left) in latest.items()
        if not active and status in DEPARTED_STATUSES and left and left <= day
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


def left_message(name, left_date, what='attendance'):
    when = left_date.strftime('%d %b %Y') if left_date else 'an earlier date'
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
