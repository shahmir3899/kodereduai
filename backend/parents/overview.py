"""
Building blocks for the parent child-overview endpoint.

Kept out of views.py so each number can be tested on its own. Two rules the old
inline version broke:
  * everything the dashboard shows is for the child's CURRENT academic year;
    all-time attendance mixes the old class with the new one after a promotion.
  * FeePayment.amount_due for a month already includes the carried-forward
    balance (amount_due = previous_balance + base amount), so summing it across
    months counts the same unpaid money several times.
"""
from collections import defaultdict
from decimal import Decimal

from django.db.models import Count

ZERO = Decimal('0')
RECENT_ATTENDANCE_DAYS = 7


def _money(value):
    return str(value if value is not None else ZERO)


def _year_bounds(academic_year_id, today):
    """(start, end) dates of the academic year, end capped at today; (None, None) without a year."""
    if not academic_year_id:
        return None, None
    from academic_sessions.models import AcademicYear

    year = AcademicYear.objects.filter(id=academic_year_id).only('start_date', 'end_date').first()
    if not year:
        return None, None
    return year.start_date, min(year.end_date, today)


def attendance_summary(student, academic_year_id, today):
    """Year-scoped attendance: counts, rate, today's status and the last few marked days."""
    from attendance.models import AttendanceRecord

    records = AttendanceRecord.objects.filter(student=student)
    start, end = _year_bounds(academic_year_id, today)
    if start:
        records = records.filter(date__gte=start, date__lte=end)

    counts = {row['status']: row['n'] for row in records.values('status').annotate(n=Count('id'))}
    present = counts.get('PRESENT', 0)
    absent = counts.get('ABSENT', 0)
    leave = counts.get('LEAVE', 0)
    total = sum(counts.values())

    recent = list(records.order_by('-date').values('date', 'status')[:RECENT_ATTENDANCE_DAYS])
    today_row = next((r for r in recent if r['date'] == today), None)
    return {
        'total_days': total,
        'present': present,
        'absent': absent,
        'leave': leave,
        'attendance_rate': round(present / total * 100, 1) if total else None,
        'today': today_row['status'] if today_row else None,
        'recent': [{'date': str(r['date']), 'status': r['status']} for r in reversed(recent)],
    }


def fee_summary(student):
    """What the family owes now, without double-counting carried-forward balances.

    Monthly fees: the latest generated month per category already contains every
    earlier unpaid month, so only that row counts. Other fee types (annual,
    admission, books, fine) have no carry-forward, so each row stands alone.
    `overdue_amount` is the part of the outstanding balance that was carried in
    from earlier months and is still unpaid.
    """
    from finance.models import FeePayment

    rows = list(FeePayment.objects.filter(student=student).values(
        'fee_type', 'monthly_category_id', 'year', 'month', 'amount_due', 'amount_paid', 'previous_balance',
    ))

    latest_monthly = {}
    for row in rows:
        if row['fee_type'] != 'MONTHLY':
            continue
        key = row['monthly_category_id']
        best = latest_monthly.get(key)
        if best is None or (row['year'], row['month']) > (best['year'], best['month']):
            latest_monthly[key] = row

    outstanding = overdue = ZERO
    unpaid_items = 0
    counted = list(latest_monthly.values()) + [r for r in rows if r['fee_type'] != 'MONTHLY']
    for row in counted:
        remaining = (row['amount_due'] or ZERO) - (row['amount_paid'] or ZERO)
        if remaining <= 0:
            continue
        outstanding += remaining
        unpaid_items += 1
        if row['fee_type'] == 'MONTHLY':
            overdue += min(row['previous_balance'] or ZERO, remaining)

    total_paid = sum((r['amount_paid'] or ZERO) for r in rows)
    return {
        'outstanding': _money(outstanding),
        'overdue_amount': _money(overdue),
        'unpaid_items': unpaid_items,
        'total_paid': _money(total_paid),
    }


def _exam_percentages(student, academic_year_id):
    """[(exam, percentage)] for published exams this year, newest first.

    Percentage is the average of the child's subject percentages, skipping
    absences and unmarked subjects, matching how the academic-risk service
    scores an exam. Only PUBLISHED exams: parents must not see unreleased marks.
    """
    from academic_sessions.roster import current_year_q
    from examinations.models import Exam, StudentMark

    marks = StudentMark.objects.filter(
        student=student,
        exam_subject__exam__status=Exam.Status.PUBLISHED,
        exam_subject__is_active=True,
        is_absent=False,
        marks_obtained__isnull=False,
    ).filter(current_year_q(academic_year_id, field='exam_subject__exam__academic_year')).select_related(
        'exam_subject', 'exam_subject__exam',
    )

    per_exam = defaultdict(list)
    exams = {}
    for mark in marks:
        total = mark.exam_subject.total_marks
        if not total:
            continue
        exam = mark.exam_subject.exam
        exams[exam.id] = exam
        per_exam[exam.id].append(float(mark.marks_obtained) / float(total) * 100)

    ordered = sorted(
        exams.values(),
        key=lambda e: (e.start_date is not None, e.start_date or 0, e.id),
        reverse=True,
    )
    return [(e, sum(per_exam[e.id]) / len(per_exam[e.id])) for e in ordered]


def _exam_block(pair):
    if not pair:
        return None
    exam, percentage = pair
    return {
        'exam_id': exam.id,
        'exam_name': exam.name,
        'percentage': round(percentage, 1),
        'start_date': str(exam.start_date) if exam.start_date else None,
    }


def latest_exams(student, academic_year_id):
    """(latest, previous) exam blocks; either may be None."""
    results = _exam_percentages(student, academic_year_id)
    latest = _exam_block(results[0]) if results else None
    previous = _exam_block(results[1]) if len(results) > 1 else None
    return latest, previous


def next_exam(student, academic_year_id, class_obj_id, today):
    """The child's soonest upcoming paper from a PUBLISHED date sheet, or None."""
    from academic_sessions.roster import current_year_q, own_section_q
    from examinations.models import ExamSubject

    paper = ExamSubject.objects.filter(
        exam__school_id=student.school_id,
        exam__class_obj_id=class_obj_id,
        exam__is_active=True,
        exam__schedule_published_at__isnull=False,
        is_active=True,
        exam_date__gte=today,
    ).filter(
        current_year_q(academic_year_id, field='exam__academic_year'),
    ).filter(
        own_section_q(student, field='exam__session_class'),
    ).select_related('exam', 'subject').order_by('exam_date', 'start_time').first()

    if not paper:
        return None
    return {
        'exam_name': paper.exam.name,
        'subject_name': paper.subject.name,
        'exam_date': str(paper.exam_date),
        'start_time': str(paper.start_time) if paper.start_time else None,
    }


def today_status(school_id, class_obj_id, today):
    """Is the school closed for this child's class today, and why."""
    from academic_sessions.calendar_rules import off_day_types_for_date

    types = off_day_types_for_date(school_id, today, class_id=class_obj_id)
    return {'date': str(today), 'is_off_day': bool(types), 'off_day_types': list(types)}


def pending_leave_count(student):
    from .models import ParentLeaveRequest

    return ParentLeaveRequest.objects.filter(student=student, status='PENDING').count()
