"""
Linking a user account to a staff member: the user must belong to the staff member's school.

Run:
    cd backend
    pytest tests/test_staff_link_school.py -v
"""
import pytest
from django.core.management import call_command

from hr.models import StaffMember
from schools.models import School, UserSchoolMembership
from users.models import User


def _staff(seed_data):
    return StaffMember.objects.filter(school_id=seed_data['SID_A'], user__isnull=True).first()


def _url(staff):
    return f'/api/hr/staff/{staff.id}/link-user-account/'


@pytest.fixture
def staff_without_user(seed_data):
    staff = _staff(seed_data)
    if staff is None:
        staff = StaffMember.objects.create(
            school_id=seed_data['SID_A'], first_name='Link', last_name='Target', employee_id='PYTEST-LINK-1',
        )
    return staff


@pytest.mark.django_db
class TestLinkUserAccount:
    def test_member_of_the_school_can_be_linked(self, seed_data, api, staff_without_user):
        user = User.objects.create_user(username='PYTEST_member', email='PYTEST_member@example.com', password='x', role='STAFF')
        UserSchoolMembership.objects.create(user=user, school_id=seed_data['SID_A'], role='STAFF')
        resp = api.post(_url(staff_without_user), {'user_id': user.id}, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200
        user.refresh_from_db()
        assert user.school_id == seed_data['SID_A']  # empty school field is filled in

    def test_member_of_another_school_with_no_school_field_is_refused(self, seed_data, api, staff_without_user):
        other = School.objects.exclude(id=seed_data['SID_A']).first() or School.objects.create(name='PYTEST other', subdomain='pytest-other')
        user = User.objects.create_user(username='PYTEST_outsider', email='PYTEST_outsider@example.com', password='x', role='STAFF')
        UserSchoolMembership.objects.create(user=user, school=other, role='STAFF')
        resp = api.post(_url(staff_without_user), {'user_id': user.id}, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 400
        assert 'does not belong' in resp.json()['error']
        staff_without_user.refresh_from_db()
        assert staff_without_user.user_id is None

    def test_user_with_no_school_at_all_is_refused(self, seed_data, api, staff_without_user):
        user = User.objects.create_user(username='PYTEST_nobody', email='PYTEST_nobody@example.com', password='x', role='STAFF')
        resp = api.post(_url(staff_without_user), {'user_id': user.id}, seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 400


@pytest.mark.django_db
class TestFixCommand:
    def test_dry_run_reports_and_apply_creates_the_membership(self, seed_data, staff_without_user, capsys):
        user = User.objects.create_user(username='PYTEST_legacy', email='PYTEST_legacy@example.com', password='x', role='STAFF', school_id=seed_data['SID_A'])
        staff_without_user.user = user
        staff_without_user.save(update_fields=['user'])
        assert not UserSchoolMembership.objects.filter(user=user).exists()

        call_command('fix_staff_user_school_links')
        assert 'WOULD FIX' in capsys.readouterr().out
        assert not UserSchoolMembership.objects.filter(user=user).exists()

        call_command('fix_staff_user_school_links', '--apply')
        assert UserSchoolMembership.objects.filter(user=user, school_id=seed_data['SID_A'], is_active=True).exists()
