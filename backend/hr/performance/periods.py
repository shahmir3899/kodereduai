"""
Working days, leave and pro-rating for one school and one date range.

Everything is loaded once per report (a handful of queries for the whole school) and then answered
from memory, because the metrics ask "is this a working day for this class / this teacher" many
thousands of times.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta

# A school week runs Monday to Saturday. Weekly and monthly targets are pro-rated by working days,
# so a vacation month asks for nothing and a week with two holidays asks for two thirds.
WORKING_DAYS_PER_WEEK = 6
WORKING_DAYS_PER_MONTH = 26


def daterange(start, end):
    cursor = start
    while cursor <= end:
        yield cursor
        cursor += timedelta(days=1)


@dataclass
class Calendar:
    """Off days for one school over [start, end]. Sundays are always off (as in calendar_rules)."""
    start: date
    end: date
    staff_off: set = field(default_factory=set)
    student_off_school: set = field(default_factory=set)
    student_off_by_class: dict = field(default_factory=lambda: defaultdict(set))

    def staff_working_days(self, start=None, end=None):
        return [d for d in daterange(start or self.start, end or self.end) if d not in self.staff_off]

    def class_working_days(self, class_id, start=None, end=None):
        class_off = self.student_off_by_class.get(class_id, set())
        return [
            d for d in daterange(start or self.start, end or self.end)
            if d not in self.student_off_school and d not in class_off
        ]


def load_calendar(school_id, start, end):
    """Two queries: the OFF_DAY entries overlapping the range, and their class links."""
    from academic_sessions.models import SchoolCalendarEntry

    cal = Calendar(start=start, end=end)
    sundays = {d for d in daterange(start, end) if d.weekday() == 6}
    cal.staff_off |= sundays
    cal.student_off_school |= sundays

    entries = list(
        SchoolCalendarEntry.objects.filter(
            school_id=school_id,
            is_active=True,
            entry_kind=SchoolCalendarEntry.EntryKind.OFF_DAY,
            start_date__lte=end,
            end_date__gte=start,
        ).values('id', 'scope', 'start_date', 'end_date', 'affects_staff', 'affects_students')
    )
    if not entries:
        return cal

    class_links = defaultdict(set)
    through = SchoolCalendarEntry.classes.through
    for entry_id, class_id in through.objects.filter(
        schoolcalendarentry_id__in=[e['id'] for e in entries if e['scope'] == SchoolCalendarEntry.Scope.CLASS]
    ).values_list('schoolcalendarentry_id', 'class_id'):
        class_links[entry_id].add(class_id)

    for e in entries:
        days = set(daterange(max(e['start_date'], start), min(e['end_date'], end)))
        if e['scope'] == SchoolCalendarEntry.Scope.SCHOOL:
            # A class-only holiday does not free the teachers: they may teach other classes.
            if e['affects_staff']:
                cal.staff_off |= days
            if e['affects_students']:
                cal.student_off_school |= days
        elif e['affects_students']:
            for class_id in class_links.get(e['id'], ()):
                cal.student_off_by_class[class_id] |= days
    return cal


def load_approved_leave(school_id, start, end, staff_ids):
    """{staff_id: set(dates)} of approved leave inside the range. One query."""
    from hr.models import LeaveApplication

    leave = defaultdict(set)
    for staff_id, s, e in LeaveApplication.objects.filter(
        school_id=school_id,
        staff_member_id__in=staff_ids,
        status=LeaveApplication.Status.APPROVED,
        start_date__lte=end,
        end_date__gte=start,
    ).values_list('staff_member_id', 'start_date', 'end_date'):
        leave[staff_id] |= set(daterange(max(s, start), min(e, end)))
    return leave


def weeks_for(working_days):
    return working_days / WORKING_DAYS_PER_WEEK


def months_for(working_days):
    return working_days / WORKING_DAYS_PER_MONTH
