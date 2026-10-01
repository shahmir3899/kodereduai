"""
GET /api/academics/class-teachers/my_students_at_risk/ — the teacher-scoped view of
the school-wide risk endpoints, which are now admin/principal-only.

Builds on seed_data/seed_sections (Class_1A split into sections A and B, two
students each). Staff teacher 0 teaches section A, staff teacher 1 section B,
staff teacher 2 has no class-teacher assignment.
"""
from datetime import date, timedelta

import pytest

from academic_sessions.attendance_risk_service import AttendanceRiskService
from academic_sessions.models import AttendanceRiskSnapshot
from academics.models import ClassTeacherAssignment
from attendance.models import AttendanceRecord
from examinations.academic_risk_service import AcademicRiskService


pytestmark = pytest.mark.django_db

URL = '/api/academics/class-teachers/my_students_at_risk/'


def _login(api, seed_data, index):
    """Token for staff teacher `index` (0-based into seed_data['staff'])."""
    return api.login(f"{seed_data['prefix']}staff_teacher{index + 1}")


def _school_days(count=13):
    day, out = date(2025, 9, 1), []
    while len(out) < count:
        if day.weekday() != 6:  # the risk service ignores Sundays
            out.append(day)
        day += timedelta(days=1)
    return out


@pytest.fixture
def risky(seed_data, seed_sections):
    """Every sectioned student fully absent for 13 school days -> HIGH attendance risk."""
    for student in seed_sections['a_students'] + seed_sections['b_students']:
        for day in _school_days():
            AttendanceRecord.objects.create(
                school=seed_data['school_a'], student=student, academic_year=seed_data['academic_year'],
                date=day, status=AttendanceRecord.AttendanceStatus.ABSENT,
            )
    return seed_sections


@pytest.fixture
def assigned(seed_data, risky):
    """Staff 0 is class teacher of section A, staff 1 of section B."""
    for staff, section in ((0, risky['section_a']), (1, risky['section_b'])):
        ClassTeacherAssignment.objects.create(
            school=seed_data['school_a'], academic_year=seed_data['academic_year'],
            session_class=section, class_obj=risky['master'], teacher=seed_data['staff'][staff],
        )
    return risky


def _ids(block):
    return {s['student_id'] for s in block['students']}


def _get(api, seed_data, token, query=''):
    return api.get(URL + query, token, seed_data['SID_A'])


def test_teacher_sees_only_their_own_section(seed_data, assigned, api):
    token = _login(api, seed_data, 0)
    response = _get(api, seed_data, token)

    assert response.status_code == 200, response.content[:300]
    body = response.json()
    assert _ids(body['attendance']) == {s.id for s in assigned['a_students']}
    assert body['attendance']['at_risk_count'] == 2
    assert [s['session_class_id'] for s in body['sections']] == [assigned['section_a'].id]


def test_other_sections_teacher_does_not_see_section_a(seed_data, assigned, api):
    body = _get(api, seed_data, _login(api, seed_data, 1)).json()

    assert _ids(body['attendance']) == {s.id for s in assigned['b_students']}


def test_admin_is_refused(seed_data, assigned, api):
    response = _get(api, seed_data, seed_data['tokens']['admin'])

    assert response.status_code == 403


def test_unassigned_teacher_gets_empty_lists(seed_data, assigned, api):
    response = _get(api, seed_data, _login(api, seed_data, 2))

    assert response.status_code == 200
    body = response.json()
    assert body['sections'] == []
    assert body['attendance']['students'] == [] and body['academic']['students'] == []


def test_legacy_master_level_assignment_covers_the_whole_class(seed_data, risky, api):
    ClassTeacherAssignment.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'],
        session_class=None, class_obj=risky['master'], teacher=seed_data['staff'][2],
    )
    body = _get(api, seed_data, _login(api, seed_data, 2)).json()

    assert _ids(body['attendance']) == {s.id for s in risky['a_students'] + risky['b_students']}


def test_limit_trims_the_list_but_not_the_count(seed_data, risky, api):
    ClassTeacherAssignment.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'],
        session_class=None, class_obj=risky['master'], teacher=seed_data['staff'][2],
    )
    body = _get(api, seed_data, _login(api, seed_data, 2), '?limit=1').json()

    assert len(body['attendance']['students']) == 1
    assert body['attendance']['at_risk_count'] == 4


def test_bad_limit_is_a_400(seed_data, assigned, api):
    assert _get(api, seed_data, _login(api, seed_data, 0), '?limit=abc').status_code == 400


def test_fresh_snapshot_is_filtered_to_the_teachers_students(seed_data, assigned, api):
    everyone = assigned['a_students'] + assigned['b_students']
    AttendanceRiskSnapshot.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'],
        total_students=len(everyone), at_risk_count=len(everyone),
        risk_levels={'HIGH': len(everyone), 'MEDIUM': 0, 'LOW': 0},
        students=[{'student_id': s.id, 'student_name': s.name, 'severity': 'HIGH'} for s in everyone],
    )
    body = _get(api, seed_data, _login(api, seed_data, 0)).json()

    assert _ids(body['attendance']) == {s.id for s in assigned['a_students']}
    assert body['attendance']['risk_levels']['HIGH'] == 2


def test_disabled_attendance_module_returns_an_empty_attendance_block(seed_data, assigned, api):
    school = seed_data['school_a']
    school.enabled_modules = {**school.enabled_modules, 'attendance': False}
    school.save(update_fields=['enabled_modules'])

    body = _get(api, seed_data, _login(api, seed_data, 0)).json()

    assert body['attendance']['students'] == []


@pytest.mark.parametrize('url', [
    '/api/sessions/attendance-risk/',
    '/api/examinations/academic-risk/',
    '/api/sessions/student-risk-score/',
])
def test_school_wide_risk_endpoints_are_admin_only(seed_data, assigned, api, url):
    school_id = seed_data['SID_A']

    assert api.get(url, _login(api, seed_data, 0), school_id).status_code == 403
    assert api.get(url, seed_data['tokens']['teacher'], school_id).status_code == 403
    assert api.get(url, seed_data['tokens']['admin'], school_id).status_code == 200
    assert api.get(url, seed_data['tokens']['principal'], school_id).status_code == 200


def test_services_default_to_the_whole_school_and_honour_an_explicit_empty_set(seed_data, risky):
    school_id, year_id = seed_data['SID_A'], seed_data['academic_year'].id
    sectioned = {s.id for s in risky['a_students'] + risky['b_students']}

    everyone = AttendanceRiskService(school_id, year_id).get_at_risk_students()
    nobody = AttendanceRiskService(school_id, year_id).get_at_risk_students(only_student_ids=[])
    only_a = AttendanceRiskService(school_id, year_id).get_at_risk_students(
        only_student_ids=[s.id for s in risky['a_students']],
    )

    assert sectioned <= _ids(everyone)
    assert nobody['total_students'] == 0 and nobody['students'] == []
    assert _ids(only_a) == {s.id for s in risky['a_students']}
    assert AcademicRiskService(school_id, year_id).get_at_risk_students(only_student_ids=[])['total_students'] == 0
