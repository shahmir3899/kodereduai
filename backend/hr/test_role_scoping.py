"""Non-admin roles see only their own HR data; colleagues are a name/designation/department directory.
Admins keep the whole school. Uses the shared seed_data school (no per-test school)."""
from datetime import date

import pytest

from hr.models import (
    LeaveApplication, PerformanceAppraisal, Payslip, SalaryStructure,
    StaffAttendance, StaffDocument, StaffMember, StaffQualification,
)

# Role -> can read the admin-only-readable HR sets (salary/appraisals/...). Manager is blocked from those outright.
OWN_ONLY_ROLES = ['teacher', 'staff', 'accountant', 'driver']
ALL_NON_ADMIN = OWN_ONLY_ROLES + ['manager']

# (url, rows carry a staff_member id)
PERSONAL_LISTS = [
    '/api/hr/salary-structures/',
    '/api/hr/payslips/',
    '/api/hr/appraisals/',
    '/api/hr/qualifications/',
    '/api/hr/documents/',
    '/api/hr/leave-applications/',
    '/api/hr/attendance/',
]
MANAGER_BLOCKED = {
    '/api/hr/salary-structures/', '/api/hr/appraisals/',
    '/api/hr/qualifications/', '/api/hr/documents/',
}
ADMIN_ONLY = [
    '/api/hr/staff/dashboard_stats/',
    '/api/hr/staff/next-employee-id/',
    '/api/hr/staff-risk/',
]
PEER_KEYS = {
    'id', 'user', 'first_name', 'last_name', 'full_name', 'photo_url',
    'department', 'department_name', 'designation', 'designation_name',
    'user_role', 'employment_status', 'is_active',
}


def _results(resp):
    body = resp.json()
    return body['results'] if isinstance(body, dict) and 'results' in body else body


@pytest.fixture
def hr_world(seed_data, api):
    from users.models import User
    from schools.models import UserSchoolMembership

    school = seed_data['school_a']
    prefix = seed_data['prefix']
    users = dict(seed_data['users'])
    token = dict(seed_data['tokens'])

    driver = User.objects.create_user(
        username=f'{prefix}driver', email=f'{prefix}driver@test.com',
        password=seed_data['password'], role='DRIVER', school=school, organization=seed_data['org'],
    )
    UserSchoolMembership.objects.create(user=driver, school=school, role='DRIVER', is_default=True)
    users['driver'] = driver
    token['driver'] = api.login(driver.username)

    staff = {}
    for name in ALL_NON_ADMIN:
        staff[name] = StaffMember.objects.create(
            school=school, user=users[name], first_name=f'{prefix}{name}', last_name='Own',
            employee_id=f'{prefix}OWN-{name}', email=f'{name}-private@test.com', phone='0300-private',
            address='private address', emergency_contact_name='private contact', notes='private note',
            employment_status='ACTIVE', employment_type='FULL_TIME', date_of_joining=date(2024, 1, 1),
        )
    # a colleague none of the roles above is allowed to read about
    staff['victim'] = seed_data['staff'][0]

    for sm in staff.values():
        SalaryStructure.objects.create(school=school, staff_member=sm, basic_salary=50000, effective_from=date(2024, 1, 1))
        Payslip.objects.create(school=school, staff_member=sm, month=3, year=2026, basic_salary=50000, net_salary=48000)
        PerformanceAppraisal.objects.create(
            school=school, staff_member=sm, review_period_start=date(2025, 1, 1),
            review_period_end=date(2025, 12, 31), rating=4,
        )
        StaffQualification.objects.create(
            school=school, staff_member=sm, qualification_name='BSc',
            qualification_type=StaffQualification.QualificationType.values[0],
        )
        StaffDocument.objects.create(
            school=school, staff_member=sm, title='CNIC', file_url='https://example.com/x.pdf',
            document_type=StaffDocument.DocumentType.values[0],
        )
        LeaveApplication.objects.create(
            school=school, staff_member=sm, start_date=date(2026, 3, 2), end_date=date(2026, 3, 3), reason='x',
        )
        StaffAttendance.objects.create(school=school, staff_member=sm, date=date(2026, 3, 2), status='PRESENT')

    return {'sid': seed_data['SID_A'], 'token': token, 'staff': staff, 'admin': seed_data['tokens']['admin']}


@pytest.mark.django_db
@pytest.mark.parametrize('url', PERSONAL_LISTS)
@pytest.mark.parametrize('role', ALL_NON_ADMIN)
def test_personal_hr_lists_return_only_own_rows(api, hr_world, role, url):
    resp = api.get(url, hr_world['token'][role], hr_world['sid'])
    if role == 'manager' and url in MANAGER_BLOCKED:
        assert resp.status_code == 403
        return
    assert resp.status_code == 200, (role, url, resp.content)
    rows = _results(resp)
    assert rows, (role, url)
    assert {r['staff_member'] for r in rows} == {hr_world['staff'][role].id}


@pytest.mark.django_db
@pytest.mark.parametrize('url', PERSONAL_LISTS)
def test_asking_for_a_colleague_by_id_returns_nothing(api, hr_world, url):
    victim = hr_world['staff']['victim'].id
    resp = api.get(f'{url}?staff_member={victim}', hr_world['token']['teacher'], hr_world['sid'])
    assert resp.status_code == 200
    assert _results(resp) == []


@pytest.mark.django_db
def test_net_pay_history_is_own_only(api, hr_world):
    resp = api.get('/api/hr/payslips/net_pay_history/?month=3&year=2026', hr_world['token']['teacher'], hr_world['sid'])
    assert resp.status_code == 200
    assert set(resp.json()['history']) == {str(hr_world['staff']['teacher'].id)}


@pytest.mark.django_db
def test_current_salary_is_own_only(api, hr_world):
    t, sid = hr_world['token']['teacher'], hr_world['sid']
    assert api.get(f"/api/hr/salary-structures/current/?staff_member={hr_world['staff']['teacher'].id}", t, sid).status_code == 200
    assert api.get(f"/api/hr/salary-structures/current/?staff_member={hr_world['staff']['victim'].id}", t, sid).status_code == 404


@pytest.mark.django_db
def test_colleague_payslip_detail_and_pdf_are_hidden(api, hr_world):
    slip = Payslip.objects.get(staff_member=hr_world['staff']['victim'])
    for url in (f'/api/hr/payslips/{slip.id}/', f'/api/hr/payslips/{slip.id}/download-pdf/'):
        assert api.get(url, hr_world['token']['driver'], hr_world['sid']).status_code == 404


@pytest.mark.django_db
@pytest.mark.parametrize('role', OWN_ONLY_ROLES)
def test_leave_balance_and_attendance_summary_are_own_only(api, hr_world, role):
    victim = hr_world['staff']['victim'].id
    t, sid = hr_world['token'][role], hr_world['sid']
    assert api.get(f'/api/hr/leave-applications/leave_balance/?staff_member={victim}', t, sid).status_code == 403
    mine = hr_world['staff'][role].id
    assert api.get(f'/api/hr/leave-applications/leave_balance/?staff_member={mine}', t, sid).status_code == 200
    resp = api.get('/api/hr/attendance/summary/?date_from=2026-03-01&date_to=2026-03-31', t, sid)
    assert resp.status_code == 200
    assert len(resp.json()) <= 1


@pytest.mark.django_db
@pytest.mark.parametrize('role', OWN_ONLY_ROLES)
def test_leave_is_always_filed_for_the_caller(api, hr_world, role):
    victim = hr_world['staff']['victim'].id
    resp = api.post('/api/hr/leave-applications/', {
        'staff_member': victim, 'start_date': '2026-04-01', 'end_date': '2026-04-02', 'reason': 'x',
    }, hr_world['token'][role], hr_world['sid'])
    assert resp.status_code == 201, resp.content
    filed = LeaveApplication.objects.get(start_date=date(2026, 4, 1))
    assert filed.staff_member_id == hr_world['staff'][role].id


@pytest.mark.django_db
@pytest.mark.parametrize('url', ADMIN_ONLY)
@pytest.mark.parametrize('role', ALL_NON_ADMIN)
def test_admin_only_hr_endpoints_refuse_other_roles(api, hr_world, role, url):
    assert api.get(url, hr_world['token'][role], hr_world['sid']).status_code == 403


@pytest.mark.django_db
@pytest.mark.parametrize('role', OWN_ONLY_ROLES)
def test_staff_list_is_a_peer_directory_except_for_own_record(api, hr_world, role):
    resp = api.get('/api/hr/staff/?page_size=100', hr_world['token'][role], hr_world['sid'])
    assert resp.status_code == 200
    rows = _results(resp)
    mine = hr_world['staff'][role].id
    assert len(rows) > 1
    for row in rows:
        if row['id'] == mine:
            assert 'phone' in row and 'emergency_contact_name' in row
        else:
            assert set(row) <= PEER_KEYS, set(row) - PEER_KEYS
    detail = api.get(f"/api/hr/staff/{hr_world['staff']['victim'].id}/", hr_world['token'][role], hr_world['sid'])
    assert detail.status_code == 200
    assert set(detail.json()) <= PEER_KEYS


@pytest.mark.django_db
def test_staff_user_filter_returns_only_that_user(api, hr_world):
    me = hr_world['staff']['staff']
    resp = api.get(f'/api/hr/staff/?user={me.user_id}&page_size=1', hr_world['token']['staff'], hr_world['sid'])
    assert [r['id'] for r in _results(resp)] == [me.id]


@pytest.mark.django_db
def test_peers_cannot_search_by_email_or_employee_id(api, hr_world):
    t, sid = hr_world['token']['teacher'], hr_world['sid']
    assert _results(api.get('/api/hr/staff/?search=private@test.com', t, sid)) == []
    assert _results(api.get('/api/hr/staff/?search=OWN-driver', t, sid)) == []
    assert _results(api.get('/api/hr/staff/?search=driver', hr_world['admin'], sid))


@pytest.mark.django_db
def test_manager_stays_blocked_from_the_staff_list(api, hr_world):
    assert api.get('/api/hr/staff/', hr_world['token']['manager'], hr_world['sid']).status_code == 403


@pytest.mark.django_db
@pytest.mark.parametrize('url', PERSONAL_LISTS + ['/api/hr/staff/', '/api/hr/staff/dashboard_stats/'])
def test_admins_still_see_everything(api, hr_world, url):
    resp = api.get(url, hr_world['admin'], hr_world['sid'])
    assert resp.status_code == 200, (url, resp.content)
    if url in PERSONAL_LISTS:
        owners = {r['staff_member'] for r in _results(resp)}
        assert hr_world['staff']['victim'].id in owners and hr_world['staff']['teacher'].id in owners
    if url == '/api/hr/staff/':
        assert 'phone' in _results(resp)[0]
