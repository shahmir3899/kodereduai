"""Shared helpers for the teacher performance tests. Everything builds on the shared seed_data
school (conftest.py at the backend root); nothing here creates schools."""
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

import pytest

from hr.performance.service import compute

KARACHI = ZoneInfo('Asia/Karachi')

# Monday 3 to Saturday 8 November 2025: six working days inside the seed academic year.
MON, TUE, WED, THU, FRI, SAT = (date(2025, 11, d) for d in range(3, 9))
WEEK = (MON, SAT)


def at(day, hour=9, minute=0):
    """An aware datetime at school time (seed schools use the default Asia/Karachi zone)."""
    return datetime.combine(day, time(hour, minute), tzinfo=KARACHI)


def stamp(obj, **fields):
    """Overwrite auto_now_add timestamps, which create() always sets to now."""
    type(obj).objects.filter(pk=obj.pk).update(**fields)


def measure(seed, key, start=WEEK[0], end=WEEK[1]):
    """{staff_id: measure dict} for one measure over the range."""
    report = compute(seed['SID_A'], start, end)
    return {r['staff_id']: r['measures'][key] for r in report['teachers']}


@pytest.fixture
def perf(seed_data):
    """seed_data with the three seeded staff marked as teaching staff."""
    for s in seed_data['staff']:
        s.is_teaching = True
        s.save(update_fields=['is_teaching'])
    return seed_data


@pytest.fixture
def enrol_class_1(perf):
    """Class_1A's four students enrolled for the seed year without a section."""
    from academic_sessions.models import StudentEnrollment

    class_1 = perf['classes'][0]
    students = [s for s in perf['students'] if s.class_obj_id == class_1.id]
    for s in students:
        StudentEnrollment.objects.create(
            school=perf['school_a'], student=s, academic_year=perf['academic_year'],
            class_obj=class_1, roll_number=s.roll_number, status='ACTIVE', is_active=True,
        )
    return students
