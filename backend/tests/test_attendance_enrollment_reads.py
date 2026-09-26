"""
Attendance labels and orders records by the placement for the record's own
year. The Student.class_obj snapshot is the current class, so last year's
records showed (and sorted by) this year's class and roll.
"""
from datetime import date, timedelta

import pytest

from academic_sessions.models import AcademicYear, StudentEnrollment
from attendance.models import AttendanceRecord


pytestmark = pytest.mark.django_db


def _results(resp):
    data = resp.json()
    return data['results'] if isinstance(data, dict) and 'results' in data else data


def _record(seed_data, student, year, day, status='PRESENT'):
    return AttendanceRecord.objects.create(
        school=seed_data['school_a'], student=student, academic_year=year,
        date=day, status=status, source='MANUAL',
    )


def test_past_year_record_shows_that_years_class_and_roll(seed_data, api):
    past = AcademicYear.objects.create(
        school=seed_data['school_a'], name='PYTEST_2024-2025',
        start_date=date(2024, 4, 1), end_date=date(2025, 3, 31), is_current=False, is_active=True,
    )
    student = seed_data['students'][0]  # snapshot: Class_1A, roll 1
    class_2 = seed_data['classes'][1]
    StudentEnrollment.objects.create(
        school=seed_data['school_a'], student=student, academic_year=past,
        class_obj=class_2, roll_number='9', status='ACTIVE', is_active=True,
    )
    record = _record(seed_data, student, past, date(2024, 6, 20))

    resp = api.get(
        f'/api/attendance/records/?date={record.date}', seed_data['tokens']['admin'], seed_data['SID_A'],
    )

    row = next(r for r in _results(resp) if r['id'] == record.id)
    assert row['class_name'] == class_2.name
    assert row['student_roll'] == '9'


def test_records_sort_by_enrollment_roll(seed_data, seed_sections, api):
    first, second = seed_sections['a_students']  # snapshot rolls 1 and 2
    StudentEnrollment.objects.filter(student=first).update(roll_number='tmp')
    StudentEnrollment.objects.filter(student=second).update(roll_number='1')
    StudentEnrollment.objects.filter(student=first).update(roll_number='2')
    day = date.today() - timedelta(days=1)
    for student in (first, second):
        _record(seed_data, student, seed_data['academic_year'], day)

    resp = api.get(
        f'/api/attendance/records/?date={day}&session_class_id={seed_sections["section_a"].id}',
        seed_data['tokens']['admin'], seed_data['SID_A'],
    )

    assert [r['student'] for r in _results(resp)] == [second.id, first.id]


def test_chronic_absentees_use_enrollment_label_and_roll(seed_data, seed_sections, api):
    student = seed_sections['a_students'][0]
    StudentEnrollment.objects.filter(student=student).update(roll_number='12')
    for offset in range(1, 8):
        _record(seed_data, student, seed_data['academic_year'], date.today() - timedelta(days=offset), 'ABSENT')

    resp = api.get(
        '/api/attendance/records/chronic_absentees/?days=30&threshold=50',
        seed_data['tokens']['admin'], seed_data['SID_A'],
    )

    assert resp.status_code == 200, resp.content[:300]
    entry = next(e['student'] for e in resp.json()['chronic_absentees'] if e['student']['id'] == student.id)
    assert entry['class_name'] == seed_sections['section_a'].label
    assert entry['roll_number'] == '12'
