"""Own attendance: present 1, late / half day 0.5; approved leave and holidays excluded."""
import pytest

from hr.models import LeaveApplication, StaffAttendance

from .conftest import FRI, MON, SAT, THU, TUE, WED, measure

pytestmark = pytest.mark.django_db


def record(perf, staff, day, status):
    StaffAttendance.objects.create(school=perf['school_a'], staff_member=staff, date=day, status=status)


def test_statuses_and_leave(perf):
    t = perf['staff'][0]
    record(perf, t, MON, 'PRESENT')
    record(perf, t, TUE, 'LATE')
    record(perf, t, WED, 'HALF_DAY')
    record(perf, t, THU, 'ABSENT')
    LeaveApplication.objects.create(
        school=perf['school_a'], staff_member=t, start_date=FRI, end_date=SAT, reason='x', status='APPROVED',
    )
    m = measure(perf, 'own_attendance')[t.id]
    assert m['due'] == 4
    assert m['score'] == pytest.approx(100 * 2 / 4)


def test_missing_record_counts_as_absent_once_the_school_records_staff(perf):
    record(perf, perf['staff'][0], MON, 'PRESENT')
    m = measure(perf, 'own_attendance')[perf['staff'][1].id]
    assert (m['due'], m['score']) == (6, 0)


def test_school_that_does_not_record_staff_attendance_drops_the_measure(perf):
    assert measure(perf, 'own_attendance')[perf['staff'][0].id]['applicable'] is False
