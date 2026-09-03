import pytest

from notifications.models import NotificationLog
from notifications.recipients import get_school_membership_users
from notifications.triggers import trigger_general
from schools.models import UserSchoolMembership
from users.models import User


@pytest.mark.django_db
class TestNotificationPhaseEMatrix:

    def test_membership_resolver_supports_cross_school_memberships(self, seed_data):
        school_a = seed_data['school_a']
        school_b = seed_data['school_b']

        # User primary school is B but membership role is TEACHER in school A.
        floating_teacher = User.objects.create_user(
            username=f"{seed_data['prefix']}floating_teacher",
            email=f"{seed_data['prefix']}floating_teacher@test.com",
            password=seed_data['password'],
            role='TEACHER',
            school=school_b,
            organization=seed_data['org'],
        )
        UserSchoolMembership.objects.create(
            user=floating_teacher,
            school=school_a,
            role=UserSchoolMembership.Role.TEACHER,
            is_default=False,
            is_active=True,
        )

        recipients = get_school_membership_users(
            school_a,
            roles=[UserSchoolMembership.Role.TEACHER],
        )

        recipient_ids = {u.id for u in recipients}
        assert floating_teacher.id in recipient_ids

    def test_trigger_general_uses_membership_scope_only(self, seed_data):
        school_a = seed_data['school_a']

        title = f"{seed_data['prefix']}PhaseE General"
        body = "Phase E membership-scope validation"

        # User exists in school A but has no eligible membership role.
        non_member_parent = User.objects.create_user(
            username=f"{seed_data['prefix']}non_member_parent",
            email=f"{seed_data['prefix']}non_member_parent@test.com",
            password=seed_data['password'],
            role='PARENT',
            school=school_a,
            organization=seed_data['org'],
        )
        UserSchoolMembership.objects.create(
            user=non_member_parent,
            school=school_a,
            role=UserSchoolMembership.Role.PARENT,
            is_default=True,
            is_active=True,
        )

        expected_members = UserSchoolMembership.objects.filter(
            school=school_a,
            is_active=True,
            role__in=[
                UserSchoolMembership.Role.SCHOOL_ADMIN,
                UserSchoolMembership.Role.PRINCIPAL,
                UserSchoolMembership.Role.TEACHER,
            ],
        ).values_list('user_id', flat=True)
        expected_ids = set(expected_members)

        sent = trigger_general(school=school_a, title=title, body=body)

        logs = NotificationLog.objects.filter(
            school=school_a,
            event_type='GENERAL',
            channel='IN_APP',
            title=title,
            body=body,
        )
        log_recipient_ids = set(logs.values_list('recipient_user_id', flat=True))

        assert sent == len(expected_ids)
        assert log_recipient_ids == expected_ids
        assert non_member_parent.id not in log_recipient_ids
