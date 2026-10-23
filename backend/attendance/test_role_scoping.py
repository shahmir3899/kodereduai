"""Student-level data (attendance, marks, results, roster) by role.

Admins: everything. TEACHER: only the sections they are class teacher of. ACCOUNTANT keeps the roster
(fees need it) but not attendance/marks/results. MANAGER keeps classes but no student-level data.
STAFF/DRIVER: none. Uses the shared seed school (no per-test school)."""
from datetime import date

import pytest

from academics.models import ClassTeacherAssignment
from attendance.models import AttendanceRecord

NO_STUDENT_DATA = ['accountant', 'manager', 'staff', 'driver']

# Student-level attendance, marks and results: admins + scoped teachers only.
STUDENT_DATA = [
    '/api/attendance/records/',
    '/api/attendance/records/register_data/?class_id=1&date_from=2026-03-01&date_to=2026-03-31',
    '/api/attendance/records/monthly_bulk/',
    '/api/attendance/records/daily_report/',
    '/api/attendance/records/chronic_absentees/',
    '/api/attendance/anomalies/',
    '/api/examinations/marks/',
    '/api/examinations/report-card/',
    '/api/examinations/report-card/meta/',
]
# School-wide attendance views a teacher must not reach either (admin/principal dashboards only).
ADMIN_ONLY_FOR_TEACHERS = [
    '/api/attendance/records/daily_report/',
    '/api/attendance/records/chronic_absentees/',
    '/api/attendance/anomalies/',
]


@pytest.fixture
def world(seed_data, seed_sections, api):
    from users.models import User
    from schools.models import UserSchoolMembership

    token = dict(seed_data['tokens'])
    school = seed_data['school_a']
    driver = User.objects.create_user(
        username=f"{seed_data['prefix']}driver", email=f"{seed_data['prefix']}driver@test.com",
        password=seed_data['password'], role='DRIVER', school=school, organization=seed_data['org'],
    )
    UserSchoolMembership.objects.create(user=driver, school=school, role='DRIVER', is_default=True)
    token['driver'] = api.login(driver.username)

    teacher = seed_data['staff'][0]
    ClassTeacherAssignment.objects.create(
        school=school, academic_year=seed_data['academic_year'], session_class=seed_sections['section_a'],
        class_obj=seed_sections['master'], teacher=teacher,
    )
    token['teacher'] = api.login(teacher.user.username)

    for student in seed_sections['a_students'] + seed_sections['b_students']:
        AttendanceRecord.objects.create(
            school=school, academic_year=seed_data['academic_year'], student=student,
            date=date(2026, 3, 2), status='PRESENT',
        )
    return {
        'sid': seed_data['SID_A'], 'token': token, 'sections': seed_sections,
        'year': seed_data['academic_year'].id,
    }


def _ids(resp):
    body = resp.json()
    rows = body['results'] if isinstance(body, dict) and 'results' in body else body
    return {r['student'] if 'student' in r else r.get('student_id') for r in rows}


@pytest.mark.django_db
@pytest.mark.parametrize('url', STUDENT_DATA)
@pytest.mark.parametrize('role', NO_STUDENT_DATA)
def test_roles_without_student_data_access_are_refused(api, world, role, url):
    assert api.get(url, world['token'][role], world['sid']).status_code == 403


@pytest.mark.django_db
@pytest.mark.parametrize('url', ADMIN_ONLY_FOR_TEACHERS)
def test_school_wide_attendance_views_are_not_for_teachers(api, world, url):
    assert api.get(url, world['token']['teacher'], world['sid']).status_code == 403


@pytest.mark.django_db
def test_teacher_records_list_only_own_section(api, world):
    resp = api.get('/api/attendance/records/?date=2026-03-02&page_size=100', world['token']['teacher'], world['sid'])
    assert resp.status_code == 200
    assert _ids(resp) == {s.id for s in world['sections']['a_students']}


@pytest.mark.django_db
def test_teacher_cannot_ask_for_another_section(api, world):
    other = world['sections']['section_b']
    resp = api.get(
        f'/api/attendance/records/?session_class_id={other.id}&date=2026-03-02', world['token']['teacher'], world['sid'],
    )
    assert resp.status_code == 200
    assert _ids(resp) == set()


@pytest.mark.django_db
def test_teacher_register_data_only_own_section(api, world):
    sec = world['sections']
    a = api.get(
        f"/api/attendance/records/register_data/?session_class_id={sec['section_a'].id}"
        f"&academic_year={world['year']}&date_from=2026-03-01&date_to=2026-03-31",
        world['token']['teacher'], world['sid'],
    )
    b = api.get(
        f"/api/attendance/records/register_data/?session_class_id={sec['section_b'].id}"
        f"&academic_year={world['year']}&date_from=2026-03-01&date_to=2026-03-31",
        world['token']['teacher'], world['sid'],
    )
    assert {r['student_id'] for r in a.json()} == {s.id for s in sec['a_students']}
    assert b.json() == []


@pytest.mark.django_db
def test_teacher_monthly_bulk_only_own_section(api, world):
    resp = api.get(
        f"/api/attendance/records/monthly_bulk/?month=3&year=2026&academic_year={world['year']}",
        world['token']['teacher'], world['sid'],
    )
    assert resp.status_code == 200
    seen = {row['student_id'] for rows in resp.json()['by_class'].values() for row in rows}
    assert seen == {s.id for s in world['sections']['a_students']}


@pytest.mark.django_db
def test_teacher_without_any_class_sees_nothing(api, world, seed_data):
    # staff_teacher2 holds no assignment
    token = api.login(seed_data['staff'][1].user.username)
    resp = api.get('/api/attendance/records/?page_size=100', token, world['sid'])
    assert resp.status_code == 200
    assert _ids(resp) == set()


@pytest.mark.django_db
@pytest.mark.parametrize('url', ['/api/attendance/records/', '/api/attendance/records/daily_report/',
                                 '/api/attendance/records/chronic_absentees/', '/api/attendance/anomalies/',
                                 '/api/examinations/marks/'])
def test_admins_still_see_student_data(api, world, url):
    assert api.get(url, world['token']['admin'], world['sid']).status_code == 200


@pytest.mark.django_db
def test_admin_sees_every_section(api, world):
    resp = api.get('/api/attendance/records/?date=2026-03-02&page_size=100', world['token']['admin'], world['sid'])
    assert len(_ids(resp)) >= 4


@pytest.mark.django_db
@pytest.mark.parametrize('role', ['accountant', 'teacher'])
def test_roster_stays_for_accountant_and_teacher(api, world, role):
    assert api.get('/api/students/', world['token'][role], world['sid']).status_code == 200


@pytest.mark.django_db
@pytest.mark.parametrize('role', ['manager', 'staff', 'driver'])
def test_roster_refused_for_manager_staff_driver(api, world, role):
    assert api.get('/api/students/', world['token'][role], world['sid']).status_code == 403


@pytest.mark.django_db
def test_manager_keeps_classes(api, world):
    assert api.get('/api/classes/', world['token']['manager'], world['sid']).status_code == 200


@pytest.mark.django_db
def test_exam_results_action_is_student_data(api, world, seed_data):
    from examinations.models import Exam, ExamType
    exam = Exam.objects.create(
        school=seed_data['school_a'], academic_year=seed_data['academic_year'], term=seed_data['terms'][0],
        exam_type=ExamType.objects.create(school=seed_data['school_a'], name='Scoping'),
        class_obj=seed_data['classes'][0], name='Scoping exam',
    )
    for role in NO_STUDENT_DATA:
        assert api.get(f'/api/examinations/exams/{exam.id}/results/', world['token'][role], world['sid']).status_code == 403
