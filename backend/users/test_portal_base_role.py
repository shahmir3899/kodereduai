"""Student and parent accounts get their own base role (it used to be STAFF, with the real role only
on the school membership), and a conservative backfill converts the accounts that already exist
(shared seed school)."""
import json
from datetime import timedelta

import pytest
from django.utils import timezone

from core.permissions import get_effective_role
from parents.models import ParentInvite, ParentProfile
from schools.models import UserSchoolMembership
from students.models import StudentInvite, StudentProfile
from users.models import User
from users.portal_roles import backfill_portal_roles, restore_portal_roles
from users.test_portal_effective_role import _request_as


def _legacy_portal_user(seed_data, name, kind, memberships=None, profiles=('student',), student_idx=5):
    """A portal account as the old code stored it: base role STAFF."""
    school = seed_data['school_a']
    user = User.objects.create_user(
        username=name, email=f'{name}@test.com', password=seed_data['password'], role='STAFF',
        school=school, organization=seed_data['org'],
    )
    for role in (memberships if memberships is not None else [kind.upper()]):
        UserSchoolMembership.objects.create(user=user, school=school, role=role, is_default=True, is_active=True)
    if 'student' in profiles:
        StudentProfile.objects.create(user=user, student=seed_data['students'][student_idx], school=school)
    if 'parent' in profiles:
        ParentProfile.objects.create(user=user, phone='0300')
    return user


# ── creation paths ──────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_single_student_account_gets_the_student_base_role(api, seed_data):
    student, sid = seed_data['students'][0], seed_data['SID_A']
    resp = api.post(f'/api/students/{student.id}/create-user-account/', {
        'username': 'role_single', 'password': seed_data['password'], 'confirm_password': seed_data['password'],
    }, seed_data['tokens']['admin'], sid)
    assert resp.status_code == 201, resp.content
    assert User.objects.get(username='role_single').role == 'STUDENT'


@pytest.mark.django_db
def test_bulk_student_accounts_get_the_student_base_role(api, seed_data):
    sid = seed_data['SID_A']
    ids = [s.id for s in seed_data['students'][:2]]
    resp = api.post('/api/students/bulk-create-accounts/', {
        'student_ids': ids, 'default_password': seed_data['password'],
    }, seed_data['tokens']['admin'], sid)
    assert resp.status_code in (200, 201), resp.content
    roles = set(User.objects.filter(student_profile__student_id__in=ids).values_list('role', flat=True))
    assert roles == {'STUDENT'}


@pytest.mark.django_db
def test_invite_registration_works_and_gets_the_student_base_role(api_client, seed_data):
    # The view called create_user() without a username, so this path raised before.
    invite = StudentInvite.objects.create(
        school=seed_data['school_a'], student=seed_data['students'][1], invite_code='ROLEINV1',
        created_by=seed_data['users']['admin'], expires_at=timezone.now() + timedelta(days=1),
    )
    resp = api_client.post('/api/students/portal/register/', data=json.dumps({
        'invite_code': invite.invite_code, 'email': 'invited@test.com',
        'password': seed_data['password'], 'full_name': 'Invited Student',
    }), content_type='application/json')
    assert resp.status_code == 201, resp.content
    user = User.objects.get(email='invited@test.com')
    assert user.username == 'invited@test.com'
    assert user.role == 'STUDENT'
    assert user.get_role_for_school(seed_data['SID_A']) == 'STUDENT'


@pytest.mark.django_db
def test_parent_registration_gets_the_parent_base_role(api_client, seed_data):
    invite = ParentInvite.objects.create(
        school=seed_data['school_a'], student=seed_data['students'][2], invite_code='ROLEPAR1',
        relation='FATHER', parent_phone='0300111', created_by=seed_data['users']['admin'],
        expires_at=timezone.now() + timedelta(days=1),
    )
    resp = api_client.post('/api/parents/register/', data=json.dumps({
        'invite_code': invite.invite_code, 'username': 'role_parent', 'password': seed_data['password'],
        'confirm_password': seed_data['password'], 'phone': '0300111', 'relation': 'FATHER',
    }), content_type='application/json')
    assert resp.status_code == 201, resp.content
    assert User.objects.get(username='role_parent').role == 'PARENT'


# ── what the new base role means ────────────────────────────────────────────

@pytest.mark.django_db
def test_login_reports_the_student_role(api_client, seed_data):
    user = _legacy_portal_user(seed_data, 'role_login', 'student')
    User.objects.filter(pk=user.pk).update(role='STUDENT')
    resp = api_client.post('/api/auth/login/', data=json.dumps({
        'username': 'role_login', 'password': seed_data['password'],
    }), content_type='application/json')
    assert resp.status_code == 200
    assert resp.json()['user']['role'] == 'STUDENT'


@pytest.mark.django_db
@pytest.mark.parametrize('role', ['STUDENT', 'PARENT'])
def test_portal_roles_cannot_be_assigned_through_the_users_api(api, seed_data, role):
    sid, admin = seed_data['SID_A'], seed_data['tokens']['admin']
    created = api.post('/api/users/', {
        'username': f'role_{role.lower()}_x', 'password': seed_data['password'],
        'confirm_password': seed_data['password'], 'role': role,
    }, admin, sid)
    assert created.status_code == 400
    patched = api.patch(f"/api/users/{seed_data['users']['teacher'].id}/", {'role': role}, admin, sid)
    assert patched.status_code == 400
    assert User.objects.get(pk=seed_data['users']['teacher'].pk).role == 'TEACHER'


@pytest.mark.django_db
def test_a_converted_account_still_resolves_to_its_membership_role(seed_data):
    user = _legacy_portal_user(seed_data, 'role_conv', 'student')
    User.objects.filter(pk=user.pk).update(role='STUDENT')
    user.refresh_from_db()
    assert get_effective_role(_request_as(user, seed_data['SID_A'])) == 'STUDENT'
    UserSchoolMembership.objects.filter(user=user).update(is_active=False)
    assert get_effective_role(_request_as(user, seed_data['SID_A'])) is None


# ── backfill ────────────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_backfill_converts_portal_accounts_only(seed_data):
    stud = _legacy_portal_user(seed_data, 'bf_student', 'student', student_idx=5)
    par = _legacy_portal_user(seed_data, 'bf_parent', 'parent', profiles=('parent',))
    teacher = seed_data['users']['teacher']

    result = backfill_portal_roles(User, UserSchoolMembership)

    assert result['converted'] == 2 and result['review'] == []
    assert User.objects.get(pk=stud.pk).role == 'STUDENT'
    assert User.objects.get(pk=par.pk).role == 'PARENT'
    assert User.objects.get(pk=teacher.pk).role == 'TEACHER'


@pytest.mark.django_db
def test_backfill_leaves_a_staff_member_who_is_also_a_parent_for_review(seed_data):
    both = _legacy_portal_user(seed_data, 'bf_both', 'parent', memberships=['STAFF'], profiles=('parent',))
    teacher_parent = _legacy_portal_user(seed_data, 'bf_teacher_parent', 'parent', memberships=['TEACHER'], profiles=('parent',))

    result = backfill_portal_roles(User, UserSchoolMembership)

    assert result['converted'] == 0
    assert sorted(result['review']) == sorted([both.pk, teacher_parent.pk])
    assert User.objects.get(pk=both.pk).role == 'STAFF'


@pytest.mark.django_db
def test_backfill_leaves_an_account_with_both_profiles_for_review(seed_data):
    both = _legacy_portal_user(seed_data, 'bf_dual', 'student', profiles=('student', 'parent'), student_idx=6)
    result = backfill_portal_roles(User, UserSchoolMembership)
    assert result['review'] == [both.pk]
    assert User.objects.get(pk=both.pk).role == 'STAFF'


@pytest.mark.django_db
def test_backfill_is_idempotent_and_reversible(seed_data):
    stud = _legacy_portal_user(seed_data, 'bf_rev', 'student')
    assert backfill_portal_roles(User, UserSchoolMembership)['converted'] == 1
    assert backfill_portal_roles(User, UserSchoolMembership)['converted'] == 0

    restore_portal_roles(User)
    assert User.objects.get(pk=stud.pk).role == 'STAFF'
