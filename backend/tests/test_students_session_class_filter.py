import pytest

from academic_sessions.models import SessionClass, StudentEnrollment


pytestmark = [pytest.mark.django_db]


def _results(resp):
    data = resp.json()
    if isinstance(data, dict):
        return data.get('results', data)
    return data


def test_students_list_filters_exact_session_class(seed_data, api):
    token = seed_data['tokens']['admin']
    sid = seed_data['SID_A']
    school = seed_data['school_a']
    academic_year = seed_data['academic_year']
    class_obj = seed_data['classes'][0]
    student_a = seed_data['students'][0]
    student_b = seed_data['students'][1]

    session_a = SessionClass.objects.create(
        school=school,
        academic_year=academic_year,
        class_obj=class_obj,
        display_name='Junior 1',
        section='A',
        grade_level=1,
        is_active=True,
    )
    session_b = SessionClass.objects.create(
        school=school,
        academic_year=academic_year,
        class_obj=class_obj,
        display_name='Junior 1',
        section='B',
        grade_level=1,
        is_active=True,
    )

    StudentEnrollment.objects.create(
        school=school,
        student=student_a,
        academic_year=academic_year,
        session_class=session_a,
        class_obj=class_obj,
        roll_number='1',
        status='ACTIVE',
        is_active=True,
    )
    StudentEnrollment.objects.create(
        school=school,
        student=student_b,
        academic_year=academic_year,
        session_class=session_b,
        class_obj=class_obj,
        roll_number='1',
        status='ACTIVE',
        is_active=True,
    )

    resp = api.get(
        f'/api/students/?class_id={class_obj.id}&session_class_id={session_a.id}&academic_year={academic_year.id}&page_size=9999',
        token,
        sid,
    )

    assert resp.status_code == 200, resp.content[:300]
    items = _results(resp)
    ids = {row['id'] for row in items}

    assert student_a.id in ids
    assert student_b.id not in ids


def test_students_list_invalid_session_class_returns_empty(seed_data, api):
    token = seed_data['tokens']['admin']
    sid = seed_data['SID_A']
    class_obj = seed_data['classes'][0]

    resp = api.get(
        f'/api/students/?class_id={class_obj.id}&session_class_id=999999&page_size=9999',
        token,
        sid,
    )

    assert resp.status_code == 200, resp.content[:300]
    assert _results(resp) == []
