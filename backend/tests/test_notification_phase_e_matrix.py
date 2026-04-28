from datetime import date, timedelta
from decimal import Decimal

import pytest

from academics.models import ClassTeacherAssignment
from finance.models import Account, FeePayment
from notifications.models import NotificationLog, SchoolNotificationConfig
from notifications.recipients import get_school_membership_users
from notifications.triggers import trigger_class_teacher_fee_pending, trigger_general
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

    def test_class_teacher_fee_pending_dedupes_per_teacher_month(self, seed_data):
        school = seed_data['school_a']
        academic_year = seed_data['academic_year']
        class_obj = seed_data['classes'][0]
        student = seed_data['students'][0]
        teacher_staff = seed_data['staff'][0]

        month = 8
        year = 2026

        SchoolNotificationConfig.objects.update_or_create(
            school=school,
            defaults={
                'in_app_enabled': True,
                'class_teacher_fee_reminder_enabled': True,
            },
        )

        ClassTeacherAssignment.objects.create(
            school=school,
            academic_year=academic_year,
            class_obj=class_obj,
            session_class=None,
            teacher=teacher_staff,
            is_active=True,
        )

        account = Account.objects.create(
            school=school,
            organization=seed_data['org'],
            name=f"{seed_data['prefix']}fee_test_account",
            account_type=Account.AccountType.CASH,
            opening_balance=Decimal('0.00'),
            is_active=True,
        )

        FeePayment.objects.create(
            school=school,
            academic_year=academic_year,
            student=student,
            fee_type='MONTHLY',
            month=month,
            year=year,
            amount_due=Decimal('1000.00'),
            amount_paid=Decimal('100.00'),
            payment_date=date.today() - timedelta(days=1),
            account=account,
        )

        first = trigger_class_teacher_fee_pending(school, month, year)
        second = trigger_class_teacher_fee_pending(school, month, year)

        title = f"Fee Pending — {class_obj.name} ({date(year, month, 1).strftime('%B %Y')})"

        logs = NotificationLog.objects.filter(
            school=school,
            channel='IN_APP',
            event_type='FEE_DUE',
            recipient_user=teacher_staff.user,
            title=title,
        )

        assert first == 1
        assert second == 0
        assert logs.count() == 1

    def test_class_teacher_fee_pending_respects_toggle_off(self, seed_data):
        school = seed_data['school_a']

        SchoolNotificationConfig.objects.update_or_create(
            school=school,
            defaults={
                'class_teacher_fee_reminder_enabled': False,
            },
        )

        sent = trigger_class_teacher_fee_pending(school, month=9, year=2026)
        assert sent == 0
