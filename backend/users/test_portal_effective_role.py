"""Student and parent accounts without an active membership must not fall back to their base role. Accounts
created before STUDENT/PARENT existed are stored as STAFF until the backfill (users 0009) has run
(shared seed school)."""
import pytest
from rest_framework.test import APIRequestFactory

from core.permissions import get_effective_role
from messaging.models import MessageThread, ThreadParticipant
from parents.models import ParentProfile
from schools.models import UserSchoolMembership
from students.models import StudentProfile
from users.models import User


def _request_as(user, school_id):
    request = APIRequestFactory().get('/', HTTP_X_SCHOOL_ID=str(school_id))
    request.user = user
    return request


def _portal_user(seed_data, kind):
    school = seed_data['school_a']
    user = User.objects.create_user(
        username=f'portal_{kind}', email=f'portal_{kind}@test.com', password=seed_data['password'], role='STAFF',  # legacy base role: accounts created before STUDENT/PARENT existed
        school=school, organization=seed_data['org'],
    )
    membership = UserSchoolMembership.objects.create(
        user=user, school=school, role=kind.upper(), is_default=True, is_active=True,
    )
    if kind == 'student':
        StudentProfile.objects.create(user=user, student=seed_data['students'][0], school=school)
    else:
        ParentProfile.objects.create(user=user, phone='0300')
    return user, membership


@pytest.mark.django_db
@pytest.mark.parametrize('kind', ['student', 'parent'])
def test_portal_user_resolves_to_the_membership_role(seed_data, kind):
    user, _ = _portal_user(seed_data, kind)
    assert get_effective_role(_request_as(user, seed_data['SID_A'])) == kind.upper()


@pytest.mark.django_db
@pytest.mark.parametrize('kind', ['student', 'parent'])
def test_portal_user_without_an_active_membership_has_no_role(seed_data, kind):
    user, membership = _portal_user(seed_data, kind)
    membership.is_active = False
    membership.save()
    assert get_effective_role(_request_as(user, seed_data['SID_A'])) is None


@pytest.mark.django_db
def test_portal_user_with_no_membership_row_has_no_role(seed_data):
    user, membership = _portal_user(seed_data, 'student')
    membership.delete()
    assert get_effective_role(_request_as(user, seed_data['SID_A'])) is None


@pytest.mark.django_db
def test_staff_roles_still_resolve_as_before(seed_data):
    teacher = seed_data['users']['teacher']
    assert get_effective_role(_request_as(teacher, seed_data['SID_A'])) == 'TEACHER'


@pytest.mark.django_db
def test_messaging_shows_the_membership_role_not_the_base_role(api, seed_data):
    student, _ = _portal_user(seed_data, 'student')
    admin = seed_data['users']['admin']
    thread = MessageThread.objects.create(school=seed_data['school_a'], created_by=admin, subject='Hello')
    ThreadParticipant.objects.create(thread=thread, user=admin)
    ThreadParticipant.objects.create(thread=thread, user=student)

    resp = api.get('/api/messaging/threads/', seed_data['tokens']['admin'], seed_data['SID_A'])
    assert resp.status_code == 200, resp.content
    body = resp.json()
    thread_row = (body['results'] if isinstance(body, dict) and 'results' in body else body)[0]
    roles = {p['user']: p['user_role'] for p in thread_row['participants']}
    assert roles[student.id] == 'STUDENT'
    assert thread_row['other_participant_role'] == 'STUDENT'
