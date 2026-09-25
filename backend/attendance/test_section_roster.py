"""
Attendance rosters are per section and go through academic_sessions.roster.
Builds on the shared seed_data/seed_sections fixtures (Class_1A split into
sections A and B sharing one master class).
"""
from datetime import date

import pytest

from academic_sessions.models import StudentEnrollment
from attendance.models import AttendanceRecord


pytestmark = pytest.mark.django_db


@pytest.fixture
def marked(seed_data, seed_sections):
    """One September record per student; A's second student left in October."""
    a_stay, a_left = seed_sections['a_students']
    StudentEnrollment.objects.filter(student=a_left, academic_year=seed_data['academic_year']).update(
        status='WITHDRAWN', is_active=False, left_date=date(2025, 10, 5),
    )
    for student in seed_sections['a_students'] + seed_sections['b_students']:
        AttendanceRecord.objects.create(
            school=seed_data['school_a'], student=student, academic_year=seed_data['academic_year'],
            date=date(2025, 9, 1), status=AttendanceRecord.AttendanceStatus.PRESENT,
        )
    return {'a_stay': a_stay, 'a_left': a_left, 'b_one': seed_sections['b_students'][0]}


def test_register_data_is_section_scoped_and_keeps_withdrawn_student(seed_data, seed_sections, marked, api):
    response = api.get(
        '/api/attendance/records/register_data/'
        f"?session_class_id={seed_sections['section_a'].id}&academic_year={seed_data['academic_year'].id}"
        '&date_from=2025-09-01&date_to=2025-09-30',
        seed_data['tokens']['admin'], seed_data['SID_A'],
    )

    assert response.status_code == 200, response.content[:300]
    assert {r['student_id'] for r in response.json()} == {marked['a_stay'].id, marked['a_left'].id}


def test_records_list_section_filter_keeps_withdrawn_students_records(seed_data, seed_sections, marked, api):
    response = api.get(
        '/api/attendance/records/'
        f"?session_class_id={seed_sections['section_a'].id}&academic_year={seed_data['academic_year'].id}"
        '&page_size=50',
        seed_data['tokens']['admin'], seed_data['SID_A'],
    )

    assert response.status_code == 200, response.content[:300]
    data = response.json()
    rows = data.get('results', data)
    student_ids = {r['student'] if isinstance(r['student'], int) else r['student']['id'] for r in rows}
    assert student_ids == {marked['a_stay'].id, marked['a_left'].id}


def test_bulk_entry_rejects_student_from_another_section(seed_data, seed_sections, marked, api):
    response = api.post(
        '/api/attendance/records/bulk_entry/',
        {
            'session_class_id': seed_sections['section_a'].id,
            'date': '2025-09-02',
            'entries': [
                {'student_id': marked['a_stay'].id, 'status': 'PRESENT'},
                {'student_id': marked['b_one'].id, 'status': 'ABSENT'},
            ],
        },
        seed_data['tokens']['admin'], seed_data['SID_A'],
    )

    assert response.status_code < 500, response.content[:300]
    assert AttendanceRecord.objects.filter(student=marked['a_stay'], date=date(2025, 9, 2)).exists()
    assert not AttendanceRecord.objects.filter(student=marked['b_one'], date=date(2025, 9, 2)).exists()
