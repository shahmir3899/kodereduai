"""daily_attendance_summary: LEAVE is a marked state, so it must never land in not_marked_count."""
from datetime import date
from unittest.mock import patch

import pytest

from attendance.models import AttendanceRecord
from attendance.summary import daily_attendance_summary
from core.bootstrap_views import _get_attendance_section

DAY = date(2026, 10, 6)
Status = AttendanceRecord.AttendanceStatus


def _mark(school, student, ay, status):
    AttendanceRecord.objects.create(
        school=school, student=student, date=DAY, status=status, academic_year=ay,
    )


@pytest.fixture(autouse=True)
def working_day():
    # Keeps the result independent of the weekday/holiday calendar.
    with patch('attendance.summary.is_off_day_for_date', return_value=False), \
            patch('attendance.summary.off_day_types_for_date', return_value=[]):
        yield


@pytest.mark.django_db
class TestDailyAttendanceSummary:

    def test_states_add_up_to_total(self, seed_data):
        school, ay = seed_data['school_a'], seed_data['academic_year']
        s = seed_data['students']
        _mark(school, s[0], ay, Status.PRESENT)
        _mark(school, s[1], ay, Status.ABSENT)
        _mark(school, s[2], ay, Status.LEAVE)

        out = daily_attendance_summary(school.id, DAY)

        assert (out['present_count'], out['absent_count'], out['leave_count']) == (1, 1, 1)
        assert out['not_marked_count'] == out['total_students'] - 3
        assert (out['present_count'] + out['absent_count'] + out['leave_count']
                + out['not_marked_count']) == out['total_students']

    def test_leave_student_is_not_unmarked(self, seed_data):
        school, ay = seed_data['school_a'], seed_data['academic_year']
        students = seed_data['students']
        for st in students[:-1]:
            _mark(school, st, ay, Status.PRESENT)
        _mark(school, students[-1], ay, Status.LEAVE)

        assert daily_attendance_summary(school.id, DAY)['not_marked_count'] == 0

    def test_student_without_record_is_unmarked(self, seed_data):
        school, ay = seed_data['school_a'], seed_data['academic_year']
        students = seed_data['students']
        for st in students[:-1]:
            _mark(school, st, ay, Status.PRESENT)

        assert daily_attendance_summary(school.id, DAY)['not_marked_count'] == 1

    def test_off_day_reports_zero_unmarked(self, seed_data):
        school = seed_data['school_a']
        with patch('attendance.summary.is_off_day_for_date', return_value=True):
            out = daily_attendance_summary(school.id, DAY)
        assert out['is_off_day'] is True
        assert out['not_marked_count'] == 0

    def test_bootstrap_section_matches_summary(self, seed_data):
        school, ay = seed_data['school_a'], seed_data['academic_year']
        _mark(school, seed_data['students'][0], ay, Status.LEAVE)

        direct = daily_attendance_summary(school.id, DAY)
        boot = _get_attendance_section(school.id, DAY, None)
        assert {k: v for k, v in boot.items() if k != 'absent_students'} == \
               {k: v for k, v in direct.items() if k != 'absent_students'}
