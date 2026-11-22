"""Who can read what on /api/hr/teacher-performance/, and that schools never see each other."""
import json

import pytest

from hr.models import StaffMember, TeacherPerformanceConfig
from schools.models import School

pytestmark = pytest.mark.django_db

BASE = '/api/hr/teacher-performance/'
RANGE = '?start=2025-11-03&end=2025-11-08'


@pytest.fixture
def teacher_token(perf, api):
    return api.login(perf['staff'][0].user.username)


def put(api_client, url, data, token, school_id):
    return api_client.put(
        url, data=json.dumps(data), content_type='application/json',
        HTTP_AUTHORIZATION=f'Bearer {token}', HTTP_X_SCHOOL_ID=str(school_id),
    )


def test_admin_and_principal_see_the_ranked_list(perf, api):
    for who in ('admin', 'principal'):
        resp = api.get(BASE + RANGE, perf['tokens'][who], perf['SID_A'])
        assert resp.status_code == 200, resp.content
        body = resp.json()
        assert {t['staff_id'] for t in body['teachers']} == {s.id for s in perf['staff']}
        assert 'missed' not in body['teachers'][0]['measures']['login_days']


def test_admin_detail_includes_missed_items(perf, api):
    sid = perf['staff'][0].id
    resp = api.get(f'{BASE}{sid}/{RANGE}', perf['tokens']['admin'], perf['SID_A'])
    assert resp.status_code == 200, resp.content
    assert resp.json()['teacher']['staff_id'] == sid
    assert 'missed' in resp.json()['teacher']['measures']['login_days']


def test_non_teaching_staff_are_not_on_the_report(perf, api):
    StaffMember.objects.filter(id=perf['staff'][2].id).update(is_teaching=False)
    resp = api.get(f"{BASE}{perf['staff'][2].id}/{RANGE}", perf['tokens']['admin'], perf['SID_A'])
    assert resp.status_code == 404


@pytest.mark.parametrize('who', ['teacher', 'manager', 'staff'])
def test_other_roles_cannot_read_the_list(perf, api, who):
    assert api.get(BASE + RANGE, perf['tokens'][who], perf['SID_A']).status_code == 403


def test_teacher_cannot_read_another_teachers_report(perf, api, teacher_token):
    other = perf['staff'][1].id
    assert api.get(f'{BASE}{other}/{RANGE}', teacher_token, perf['SID_A']).status_code == 403
    own = perf['staff'][0].id
    assert api.get(f'{BASE}{own}/{RANGE}', teacher_token, perf['SID_A']).status_code == 403


def test_teacher_reads_own_report_with_rank_but_no_one_elses(perf, api, teacher_token):
    resp = api.get(BASE + 'my/' + RANGE, teacher_token, perf['SID_A'])
    assert resp.status_code == 200, resp.content
    body = resp.json()
    assert body['teacher']['staff_id'] == perf['staff'][0].id
    assert body['out_of'] == 3 and body['teacher']['rank'] is not None
    assert 'teachers' not in body and 'config' not in body
    text = json.dumps(body)
    for other in perf['staff'][1:]:
        assert other.first_name not in text


def test_rank_hidden_when_the_school_turns_it_off(perf, api, teacher_token):
    TeacherPerformanceConfig.objects.update_or_create(school=perf['school_a'], defaults={'show_rank_to_teachers': False})
    body = api.get(BASE + 'my/' + RANGE, teacher_token, perf['SID_A']).json()
    assert body['teacher']['rank'] is None and body['out_of'] is None


def test_user_without_a_staff_record_has_no_own_report(perf, api):
    assert api.get(BASE + 'my/', perf['tokens']['teacher'], perf['SID_A']).status_code == 404


def test_other_school_never_sees_school_a(perf, api):
    # School B's admin asking for school A: the header does not resolve to a school they can
    # use, so there is no school context and nothing is returned.
    resp = api.get(BASE + RANGE, perf['tokens']['admin_b'], perf['SID_A'])
    assert resp.status_code in (400, 403) and 'teachers' not in resp.json()
    # Their own school's report holds none of school A's teachers.
    resp = api.get(BASE + RANGE, perf['tokens']['admin_b'], perf['SID_B'])
    assert resp.status_code == 200, resp.content
    assert resp.json()['teachers'] == []
    sid = perf['staff'][0].id
    assert api.get(f'{BASE}{sid}/{RANGE}', perf['tokens']['admin_b'], perf['SID_B']).status_code == 404


def test_module_gating(perf, api):
    school = School.objects.get(id=perf['SID_A'])
    modules = dict(school.enabled_modules or {})
    modules['hr'] = False
    School.objects.filter(id=school.id).update(enabled_modules=modules)
    assert api.get(BASE + RANGE, perf['tokens']['admin'], perf['SID_A']).status_code == 403


def test_config_read_and_validated_write(perf, api, api_client, teacher_token):
    url = BASE + 'config/'
    resp = api.get(url, perf['tokens']['admin'], perf['SID_A'])
    assert resp.status_code == 200 and resp.json()['attendance_cutoff_time'] == '11:00'

    bad = dict(resp.json()['weights'], login_days=50)
    resp = put(api_client, url, {'weights': bad}, perf['tokens']['admin'], perf['SID_A'])
    assert resp.status_code == 400 and 'weights' in resp.json()

    resp = put(api_client, url, {'attendance_cutoff_time': '10:30', 'homework_per_week': 3}, perf['tokens']['admin'], perf['SID_A'])
    assert resp.status_code == 200, resp.content
    cfg = TeacherPerformanceConfig.objects.get(school_id=perf['SID_A'])
    assert (cfg.attendance_cutoff_time.strftime('%H:%M'), cfg.homework_per_week) == ('10:30', 3)

    assert put(api_client, url, {'homework_per_week': 9}, teacher_token, perf['SID_A']).status_code == 403
    assert api.get(url, teacher_token, perf['SID_A']).status_code == 403


def test_explainer_uses_the_schools_numbers(perf, api, teacher_token):
    TeacherPerformanceConfig.objects.update_or_create(school=perf['school_a'], defaults={'marks_deadline_days': 5})
    resp = api.get(BASE + 'explainer/', teacher_token, perf['SID_A'])
    assert resp.status_code == 200, resp.content
    rules = {m['key']: m['rule'] for m in resp.json()['measures']}
    assert '5 days' in rules['marks_entry']
    assert '11:00 am' in rules['attendance_marking']
    assert 'quickest_wins' in resp.json()
