"""
Attendance coverage of the academic calendar: for every day of an academic year, was the school's
attendance recorded?

Unit of measure is a *class-day* (one class on one working day), so a day where 6 of 8 classes marked
attendance scores 6/8 instead of failing outright. A class counts as marked on a day when any of its
students has an AttendanceRecord for that date.

Day states
  off          Sunday or a student-affecting OFF day: nothing is expected
  upcoming     after today
  untracked    before the school's first attendance record of the year, or no classes to mark
  pending      today, not every class has marked yet (not counted either way until the day ends)
  recorded     every expected class marked
  partial      some, not all, classes marked
  missed       no class marked

Streak = consecutive working days, counting back from the latest finished day (today counts once it is
complete), on which every expected class marked attendance on the day itself (the record was created that
day). Pace = how many of the last PACE_WINDOW tracked working days were like that.
"""
from datetime import timedelta

from django.db.models import Count, F, Min, OuterRef, Q, Subquery
from django.db.models.functions import TruncDate
from django.utils import timezone

from attendance.models import AttendanceRecord

from .calendar_rules import build_student_off_day_set
from .models import StudentEnrollment

PACE_WINDOW = 20


def _class_key(session_class_id, class_obj_id):
    # SessionClass is the unit when the year has one (classes are scoped per section); the master
    # class is only the fallback for enrollments that were never placed in a session class.
    return ('s', session_class_id) if session_class_id else ('c', class_obj_id)


def _daterange(start, end):
    cursor = start
    while cursor <= end:
        yield cursor
        cursor += timedelta(days=1)


def attendance_coverage(school_id, academic_year, today=None):
    """Day-by-day coverage for the whole academic year. Callers slice ``days`` to the window they show."""
    today = today or timezone.localdate()
    start, end = academic_year.start_date, academic_year.end_date

    off_days = build_student_off_day_set(school_id, start, end)

    # Which classes exist this year, and until when each is expected to mark.
    class_end = {}  # key -> None (runs to year end) or the last left_date among its students
    for row in StudentEnrollment.objects.filter(school_id=school_id, academic_year=academic_year).values(
        'session_class_id', 'class_obj_id', 'left_date',
    ):
        key = _class_key(row['session_class_id'], row['class_obj_id'])
        left = row['left_date']
        if key not in class_end:
            class_end[key] = left
        elif class_end[key] is not None:
            class_end[key] = None if left is None else max(class_end[key], left)

    enrollment = StudentEnrollment.objects.filter(
        student_id=OuterRef('student_id'), academic_year=academic_year,
    )
    marked_rows = (
        AttendanceRecord.objects
        .filter(school_id=school_id, academic_year=academic_year, date__range=(start, end))
        .annotate(
            sc=Subquery(enrollment.values('session_class_id')[:1]),
            co=Subquery(enrollment.values('class_obj_id')[:1]),
            created_day=TruncDate('created_at'),
        )
        .values('date', 'sc', 'co')
        .annotate(records=Count('id'), same_day=Count('id', filter=Q(created_day=F('date'))))
    )
    marked = {}  # date -> {class key: created on the day itself?}
    for row in marked_rows:
        if row['sc'] is None and row['co'] is None:
            continue  # a record whose student has no enrollment this year cannot be assigned to a class
        key = _class_key(row['sc'], row['co'])
        on_day = marked.setdefault(row['date'], {})
        on_day[key] = on_day.get(key, False) or row['same_day'] > 0

    tracking_started = (
        AttendanceRecord.objects.filter(school_id=school_id, academic_year=academic_year)
        .aggregate(first=Min('date'))['first']
    )

    days = []
    for day in _daterange(start, end):
        if day in off_days:
            state, expected, done, on_time = 'off', 0, 0, False
        elif day > today:
            state, expected, done, on_time = 'upcoming', 0, 0, False
        else:
            expected_keys = [k for k, ended in class_end.items() if ended is None or day < ended]
            if tracking_started is None or day < tracking_started or not expected_keys:
                state, expected, done, on_time = 'untracked', 0, 0, False
            else:
                day_marks = marked.get(day, {})
                expected = len(expected_keys)
                done = sum(1 for k in expected_keys if k in day_marks)
                on_time = done == expected and all(day_marks[k] for k in expected_keys)
                if done == expected:
                    state = 'recorded'
                elif day == today:
                    state = 'pending'
                elif done == 0:
                    state = 'missed'
                else:
                    state = 'partial'
        days.append({
            'date': day,
            'state': state,
            'classes_marked': done,
            'classes_expected': expected,
            'on_time': on_time,
        })

    return {
        'tracking_started': tracking_started,
        'days': days,
        'streak': _streak(days),
    }


def _streak(days):
    """Current streak and pace over finished, tracked working days, newest first."""
    finished = [d for d in reversed(days) if d['state'] in ('recorded', 'partial', 'missed')]
    streak = 0
    for d in finished:
        if not d['on_time']:
            break
        streak += 1
    window = finished[:PACE_WINDOW]
    return {
        'current': streak,
        'pace_on_time': sum(1 for d in window if d['on_time']),
        'pace_window': len(window),
    }


def summarize(days):
    """Recorded percent over a slice of days: marked class-days of expected class-days, finished days only."""
    counted = [d for d in days if d['state'] in ('recorded', 'partial', 'missed')]
    expected = sum(d['classes_expected'] for d in counted)
    marked = sum(d['classes_marked'] for d in counted)
    return {
        'marked': marked,
        'expected': expected,
        'percent': round(marked / expected * 100) if expected else None,
        'missed_days': sum(1 for d in counted if d['state'] == 'missed'),
        'partial_days': sum(1 for d in counted if d['state'] == 'partial'),
    }
