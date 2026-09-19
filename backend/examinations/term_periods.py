"""
Date range used for a term's attendance.

Terms are often stored as just the exam window (e.g. "1st Term" = the 9 days of the
exam), so counting attendance strictly between a term's own start and end dates
covers only a handful of days. Attendance is a whole-term measure: for a short
(exam-window) term it runs from the day after the previous term ended (or, for the
first term, from the earliest attendance record in the year leading up to it)
through the term's end date. A term that already spans 30+ days is used as entered.
"""

from datetime import timedelta

from django.db.models import Min

MIN_FULL_TERM_DAYS = 30


def attendance_period(school_id, term, academic_year):
    """(start, end) for attendance. With no term, the whole academic year."""
    if term is None:
        return academic_year.start_date, academic_year.end_date

    from academic_sessions.models import Term
    from attendance.models import AttendanceRecord

    start, end = term.start_date, term.end_date
    if not (start and end):
        return start, end
    if (end - start).days >= MIN_FULL_TERM_DAYS:
        # Already a real term (not just an exam window): honour its dates as entered.
        return start, end

    previous = Term.objects.filter(
        academic_year_id=term.academic_year_id, end_date__lt=start,
    ).order_by('-end_date').first()
    if previous and previous.end_date:
        return previous.end_date + timedelta(days=1), end

    earliest = AttendanceRecord.objects.filter(
        school_id=school_id, date__lte=end, date__gte=end - timedelta(days=366),
    ).aggregate(first=Min('date'))['first']
    return (min(earliest, start) if earliest else start), end


# More than this share of working days with no attendance recorded is flagged as suspect data.
ATTENDANCE_SUSPECT_UNMARKED_RATIO = 0.25


def report_attendance_window(exams, academic_year):
    """Date range the report card counts attendance over: each ticked exam's own term
    (start -> end); an exam with no term counts its calendar month (a monthly test).
    Several exams span the first one's start to the last one's end. Falls back to the
    academic year."""
    import calendar
    starts, ends = [], []
    for exam in exams:
        term = exam.term
        if term and term.start_date and term.end_date:
            starts.append(term.start_date)
            ends.append(term.end_date)
            continue
        ref = exam.start_date or exam.end_date
        if ref:
            starts.append(ref.replace(day=1))
            ends.append(ref.replace(day=calendar.monthrange(ref.year, ref.month)[1]))
    if not starts:
        return academic_year.start_date, academic_year.end_date
    return min(starts), max(ends)


def attendance_summaries(school_id, student_ids, start, end, class_id):
    """{student_id: attendance dict} over [start, end], stopping at today.

    The one definition of a student's attendance: the printed report card header and
    the AI comments both use it, so the two can never quote different numbers (an AI
    comment once claimed attendance over "five school days" beside a 40/48 header)."""
    from datetime import date

    from academic_sessions.calendar_rules import build_student_off_day_set
    from attendance.models import AttendanceRecord

    if not (start and end and student_ids):
        return {}
    window_end = min(end, date.today())
    off_days = build_student_off_day_set(school_id, start, window_end, class_id=class_id)
    working_days = max((window_end - start).days + 1 - len(off_days), 0) if window_end >= start else 0

    statuses = {sid: {} for sid in student_ids}
    for sid, rec_date, rec_status in AttendanceRecord.objects.filter(
        school_id=school_id, student_id__in=student_ids, date__gte=start, date__lte=window_end,
    ).values_list('student_id', 'date', 'status'):
        if rec_date not in off_days:
            statuses[sid][rec_date] = rec_status

    result = {}
    for sid, by_date in statuses.items():
        counts = {'PRESENT': 0, 'ABSENT': 0, 'LEAVE': 0}
        for rec_status in by_date.values():
            if rec_status in counts:
                counts[rec_status] += 1
        marked = sum(counts.values())
        not_marked = max(working_days - marked, 0)
        result[sid] = {
            'present': counts['PRESENT'],
            'absent': counts['ABSENT'],
            'leave': counts['LEAVE'],
            'not_marked': not_marked,
            'working_days': working_days,
            'total': marked,
            # A percentage over working days only means something when every one of
            # them was recorded; otherwise unmarked days would silently count against
            # (or be ignored for) the student, so it is withheld.
            'percentage': (
                round(counts['PRESENT'] / working_days * 100, 2)
                if working_days and not_marked == 0 else None
            ),
            'suspect': bool(working_days and not_marked / working_days > ATTENDANCE_SUSPECT_UNMARKED_RATIO),
            'from': start.isoformat(),
            'to': window_end.isoformat(),
        }
    return result
