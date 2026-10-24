"""A student is expected from their admission date and until their leaving date, not outside it.

Builds on the shared seed_data/seed_sections fixtures (Class_1A split into sections).
"""
from datetime import date
from unittest.mock import patch

import pytest

from academic_sessions.leaving import enrolled_on_q, expected_student_ids, not_yet_admitted
from academic_sessions.models import StudentEnrollment
from attendance.models import AttendanceRecord
from attendance.summary import daily_attendance_summary
from students.models import Student
from students.serializers import StudentUpdateSerializer

pytestmark = pytest.mark.django_db

ADMITTED = date(2025, 9, 10)


@pytest.fixture(autouse=True)
def working_day():
    with patch('attendance.summary.is_off_day_for_date', return_value=False), \
            patch('attendance.summary.off_day_types_for_date', return_value=[]):
        yield


@pytest.fixture
def newcomer(seed_data, seed_sections):
    """Section A's second student, admitted on ADMITTED."""
    student = seed_sections['a_students'][1]
    Student.objects.filter(pk=student.pk).update(admission_date=ADMITTED)
    return student


def _bulk(api, seed_data, seed_sections, student, day):
    return api.post(
        '/api/attendance/records/bulk_entry/',
        {
            'session_class_id': seed_sections['section_a'].id,
            'date': day,
            'entries': [{'student_id': student.id, 'status': 'PRESENT'}],
        },
        seed_data['tokens']['admin'], seed_data['SID_A'],
    )


def test_marking_before_admission_is_refused(seed_data, seed_sections, newcomer, api):
    response = _bulk(api, seed_data, seed_sections, newcomer, '2025-09-09')

    assert response.status_code < 500, response.content[:300]
    errors = response.json()['errors']
    assert [e['student_id'] for e in errors] == [newcomer.id]
    assert 'admitted on 10 Sep 2025' in errors[0]['error']
    assert not AttendanceRecord.objects.filter(student=newcomer).exists()


def test_marking_on_admission_day_is_allowed(seed_data, seed_sections, newcomer, api):
    response = _bulk(api, seed_data, seed_sections, newcomer, '2025-09-10')

    assert response.status_code == 200, response.content[:300]
    assert response.json()['errors'] == []
    assert AttendanceRecord.objects.filter(student=newcomer, date=ADMITTED).exists()


def test_student_without_admission_date_has_no_lower_bound(seed_data, seed_sections, api):
    student = seed_sections['a_students'][0]
    Student.objects.filter(pk=student.pk).update(admission_date=None)

    response = _bulk(api, seed_data, seed_sections, student, '2025-09-02')

    assert response.json()['errors'] == []


def test_helpers_follow_the_admission_date(seed_data, newcomer):
    school_id, ay = seed_data['school_a'].id, seed_data['academic_year']

    assert not_yet_admitted(school_id, [newcomer.id], date(2025, 9, 9)) == {newcomer.id: ADMITTED}
    assert not_yet_admitted(school_id, [newcomer.id], ADMITTED) == {}
    assert newcomer.id not in expected_student_ids(school_id, date(2025, 9, 9), ay.id)
    assert newcomer.id in expected_student_ids(school_id, ADMITTED, ay.id)
    assert StudentEnrollment.objects.filter(student=newcomer).filter(enrolled_on_q(date(2025, 9, 9))).count() == 0
    assert StudentEnrollment.objects.filter(student=newcomer).filter(enrolled_on_q(ADMITTED)).count() == 1


def test_daily_summary_counts_a_student_only_inside_their_window(seed_data, seed_sections, newcomer):
    school, ay = seed_data['school_a'], seed_data['academic_year']
    before = daily_attendance_summary(school.id, date(2025, 9, 9), ay.id)['total_students']
    on_day = daily_attendance_summary(school.id, ADMITTED, ay.id)['total_students']
    assert on_day == before + 1

    # Leaves on 20 Sep: still expected on the 19th, not from the 20th.
    StudentEnrollment.objects.filter(student=newcomer, academic_year=ay).update(
        status='WITHDRAWN', is_active=False, left_date=date(2025, 9, 20),
    )
    assert daily_attendance_summary(school.id, date(2025, 9, 19), ay.id)['total_students'] == on_day
    assert daily_attendance_summary(school.id, date(2025, 9, 20), ay.id)['total_students'] == on_day - 1


def test_departed_students_earlier_marks_still_count_on_those_days(seed_data, seed_sections, newcomer):
    school, ay = seed_data['school_a'], seed_data['academic_year']
    AttendanceRecord.objects.create(
        school=school, student=newcomer, academic_year=ay, date=date(2025, 9, 12),
        status=AttendanceRecord.AttendanceStatus.PRESENT,
    )
    StudentEnrollment.objects.filter(student=newcomer, academic_year=ay).update(
        status='WITHDRAWN', is_active=False, left_date=date(2025, 9, 20),
    )

    out = daily_attendance_summary(school.id, date(2025, 9, 12), ay.id)

    assert out['present_count'] == 1
    assert out['present_count'] <= out['total_students']


def test_admission_date_cannot_move_past_existing_attendance(seed_data, seed_sections, newcomer):
    AttendanceRecord.objects.create(
        school=seed_data['school_a'], student=newcomer, academic_year=seed_data['academic_year'],
        date=ADMITTED, status=AttendanceRecord.AttendanceStatus.PRESENT,
    )

    late = StudentUpdateSerializer(newcomer, data={'admission_date': '2025-09-15'}, partial=True)
    assert not late.is_valid()
    assert 'admission_date' in late.errors
    assert '10 Sep 2025' in str(late.errors['admission_date'])

    earlier = StudentUpdateSerializer(newcomer, data={'admission_date': '2025-09-01'}, partial=True)
    assert earlier.is_valid(), earlier.errors
