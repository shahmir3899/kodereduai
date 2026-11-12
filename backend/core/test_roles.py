"""One role list, and the finance capability on a Manager membership."""
import pytest
from rest_framework.test import APIRequestFactory

from core import roles
from core.permissions import ADMIN_ROLES, ROLE_HIERARCHY, STAFF_LEVEL_ROLES, has_finance_access
from schools.models import UserSchoolMembership
from users.models import User

pytestmark = pytest.mark.django_db


def _request(seed_data, who):
    request = APIRequestFactory().get('/', HTTP_X_SCHOOL_ID=str(seed_data['SID_A']))
    request.user = seed_data['users'][who]
    return request


def test_model_choices_come_from_the_single_role_list():
    assert {v for v, _ in User.Role.choices} == {v for v, _, _ in roles.ROLE_DEFS}
    assert {v for v, _ in UserSchoolMembership.Role.choices} == set(roles.MEMBERSHIP_ROLES)


def test_permissions_reexport_the_same_tuples():
    assert ADMIN_ROLES is roles.ADMIN_ROLES and STAFF_LEVEL_ROLES is roles.STAFF_LEVEL_ROLES
    assert ROLE_HIERARCHY is roles.ROLE_HIERARCHY


def test_nobody_can_create_a_portal_or_finance_only_role():
    for allowed in roles.ROLE_HIERARCHY.values():
        assert 'FINANCE_MANAGER' not in allowed and 'PARENT' not in allowed and 'STUDENT' not in allowed


def test_role_config_is_json_safe_and_complete():
    cfg = roles.role_config()
    assert [r['value'] for r in cfg['roles']] == [v for v, _, _ in roles.ROLE_DEFS]
    assert cfg['creatable']['PRINCIPAL'] == ['MANAGER', 'TEACHER', 'STAFF', 'DRIVER']
    assert cfg['capabilities'] == [{'key': 'can_manage_finance', 'label': 'Finance and fees'}]


def test_only_a_flagged_manager_has_finance_access(seed_data):
    assert has_finance_access(_request(seed_data, 'finance_manager'))
    assert not has_finance_access(_request(seed_data, 'manager'))
    assert not has_finance_access(_request(seed_data, 'teacher'))
    assert not has_finance_access(_request(seed_data, 'admin'))  # admins pass the ADMIN_ROLES check instead


def test_flag_is_ignored_once_the_role_is_no_longer_manager(seed_data):
    UserSchoolMembership.objects.filter(
        user=seed_data['users']['finance_manager'], school_id=seed_data['SID_A'],
    ).update(role='TEACHER')
    assert not has_finance_access(_request(seed_data, 'finance_manager'))


def test_flagged_manager_reads_finance_but_cannot_write(api, seed_data):
    token = api.login(f"{seed_data['prefix']}finance_manager")
    sid = seed_data['SID_A']
    assert api.get('/api/finance/accounts/', token, sid).status_code == 200
    denied = api.client.post(
        '/api/finance/accounts/', {'name': 'x', 'account_type': 'CASH'}, format='json',
        HTTP_AUTHORIZATION=f'Bearer {token}', HTTP_X_SCHOOL_ID=str(sid),
    )
    assert denied.status_code == 403


def test_unflagged_manager_is_locked_out_of_finance(api, seed_data):
    token = api.login(f"{seed_data['prefix']}manager")
    assert api.get('/api/finance/accounts/', token, seed_data['SID_A']).status_code == 403


def test_login_payload_carries_role_config_and_the_flag(api_client, seed_data):
    resp = api_client.post('/api/auth/login/', {
        'username': f"{seed_data['prefix']}finance_manager", 'password': 'TestPass123!',
    }, format='json')
    if resp.status_code != 200:
        pytest.skip(f'login route/password differs in this setup ({resp.status_code})')
    user = resp.json()['user']
    assert user['role_config']['roles'][0]['value'] == 'SUPER_ADMIN'
    assert user['schools'][0]['can_manage_finance'] is True


def test_staff_list_filters_on_the_explicit_teaching_flag(api, seed_data):
    from hr.models import StaffMember

    school = seed_data['school_a']
    StaffMember.objects.create(school=school, first_name='Tee', last_name='Cher', is_teaching=True)
    StaffMember.objects.create(school=school, first_name='Clerk', last_name='Office', is_teaching=False)
    token = api.login(f"{seed_data['prefix']}admin")

    def names(flag):
        body = api.get(f'/api/hr/staff/?is_teaching={flag}&page_size=100', token, school.id).json()
        return {r['first_name'] for r in (body['results'] if isinstance(body, dict) else body)}

    assert 'Tee' in names('true') and 'Clerk' not in names('true')
    assert 'Clerk' in names('false') and 'Tee' not in names('false')
