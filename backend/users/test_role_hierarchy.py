"""A school-level admin may only manage users whose role they could create.
The Settings page hid this; the API did not enforce it (shared seed school)."""
import pytest

from users.models import User


def _patch(api, seed_data, who, target, data):
    return api.patch(f"/api/users/{seed_data['users'][target].id}/", data, seed_data['tokens'][who], seed_data['SID_A'])


@pytest.mark.django_db
def test_admin_cannot_make_anyone_super_admin(api, seed_data):
    resp = _patch(api, seed_data, 'admin', 'teacher', {'role': 'SUPER_ADMIN'})
    assert resp.status_code == 400
    assert User.objects.get(pk=seed_data['users']['teacher'].pk).role == 'TEACHER'


@pytest.mark.django_db
def test_principal_cannot_deactivate_school_admin(api, seed_data):
    resp = _patch(api, seed_data, 'principal', 'admin', {'is_active': False})
    assert resp.status_code == 403
    assert User.objects.get(pk=seed_data['users']['admin'].pk).is_active


@pytest.mark.django_db
def test_principal_cannot_promote_to_school_admin(api, seed_data):
    resp = _patch(api, seed_data, 'principal', 'teacher', {'role': 'SCHOOL_ADMIN'})
    assert resp.status_code == 400


@pytest.mark.django_db
def test_admin_can_edit_and_deactivate_lower_roles(api, seed_data):
    assert _patch(api, seed_data, 'admin', 'staff', {'first_name': 'Edited'}).status_code == 200
    assert _patch(api, seed_data, 'admin', 'staff', {'is_active': False}).status_code == 200
    assert not User.objects.get(pk=seed_data['users']['staff'].pk).is_active


@pytest.mark.django_db
def test_role_edit_updates_the_school_membership_too(api, seed_data):
    resp = _patch(api, seed_data, 'admin', 'accountant', {'role': 'MANAGER'})
    assert resp.status_code == 200
    user = User.objects.get(pk=seed_data['users']['accountant'].pk)
    assert user.role == 'MANAGER'
    assert user.get_role_for_school(seed_data['SID_A']) == 'MANAGER'


@pytest.mark.django_db
def test_delete_deactivates_instead_of_removing(api, seed_data):
    target = seed_data['users']['manager']
    resp = api.delete(f'/api/users/{target.id}/', seed_data['tokens']['admin'], seed_data['SID_A'])
    assert resp.status_code == 204
    assert User.objects.get(pk=target.pk).is_active is False


@pytest.mark.django_db
def test_cannot_delete_a_user_above_you(api, seed_data):
    resp = api.delete(f"/api/users/{seed_data['users']['admin'].id}/", seed_data['tokens']['principal'], seed_data['SID_A'])
    assert resp.status_code == 403
    assert User.objects.get(pk=seed_data['users']['admin'].pk).is_active


@pytest.mark.django_db
def test_nobody_edits_themselves_into_a_higher_role(api, seed_data):
    resp = _patch(api, seed_data, 'admin', 'admin', {'role': 'SUPER_ADMIN'})
    assert resp.status_code == 403


@pytest.mark.django_db
def test_principal_cannot_reset_a_school_admins_password(api, seed_data):
    resp = api.post(
        f"/api/users/{seed_data['users']['admin'].id}/reset_password/",
        {'mode': 'set', 'new_password': 'NewPass123!', 'confirm_password': 'NewPass123!'},
        seed_data['tokens']['principal'], seed_data['SID_A'],
    )
    assert resp.status_code == 403
    assert seed_data['users']['admin'].check_password(seed_data['password'])
