from datetime import date, time, timedelta
from unittest.mock import patch

import pytest

from notifications.models import NotificationLog, SchoolNotificationConfig
from notifications.triggers import trigger_daily_school_report, trigger_lesson_plan_published
from parents.models import ParentChild, ParentProfile
from schools.models import UserSchoolMembership
from students.models import StudentProfile
from transport.models import RouteJourney, TransportAssignment, TransportRoute, TransportStop
from transport.triggers import trigger_bus_arriving_stop
from users.models import User


@pytest.mark.django_db
class TestNotificationCorrectnessTriggers:

    class _AlwaysSuccessHandler:
        def send(self, recipient, title, body, metadata=None):
            return True

    def test_lesson_plan_uses_student_profile_user_and_dedupes(self, seed_data):
        from lms.models import LessonPlan

        school = seed_data['school_a']
        student = seed_data['students'][0]

        student_user = User.objects.create_user(
            username=f"{seed_data['prefix']}student_notify",
            email=f"{seed_data['prefix']}student_notify@test.com",
            password=seed_data['password'],
            role='STUDENT',
            school=school,
            organization=seed_data['org'],
        )
        UserSchoolMembership.objects.create(
            user=student_user,
            school=school,
            role=UserSchoolMembership.Role.STUDENT,
            is_default=True,
        )
        StudentProfile.objects.create(
            user=student_user,
            student=student,
            school=school,
        )

        lesson_plan = LessonPlan.objects.create(
            school=school,
            academic_year=seed_data['academic_year'],
            class_obj=student.class_obj,
            subject=seed_data['subjects'][0],
            teacher=seed_data['staff'][0],
            title=f"{seed_data['prefix']}Lesson Plan Correctness",
            description='Notification correctness regression test',
            objectives='Understand fraction basics',
            lesson_date=date.today() + timedelta(days=2),
            status=LessonPlan.Status.PUBLISHED,
        )

        first = trigger_lesson_plan_published(lesson_plan)
        second = trigger_lesson_plan_published(lesson_plan)

        title = f"New Lesson Plan: {lesson_plan.title}"
        logs = NotificationLog.objects.filter(
            school=school,
            channel='IN_APP',
            event_type='GENERAL',
            recipient_user=student_user,
            student=student,
            title=title,
        )

        assert first == 1
        assert second == 0
        assert logs.count() == 1

    def test_transport_uses_parentchild_mapping_and_dedupes(self, seed_data):
        school = seed_data['school_a']
        student = seed_data['students'][0]

        parent_user = User.objects.create_user(
            username=f"{seed_data['prefix']}transport_parent",
            email=f"{seed_data['prefix']}transport_parent@test.com",
            password=seed_data['password'],
            role='PARENT',
            school=school,
            organization=seed_data['org'],
        )
        UserSchoolMembership.objects.create(
            user=parent_user,
            school=school,
            role=UserSchoolMembership.Role.PARENT,
            is_default=True,
        )
        parent_profile = ParentProfile.objects.create(
            user=parent_user,
            phone='+923001110000',
        )
        ParentChild.objects.create(
            parent=parent_profile,
            student=student,
            school=school,
            relation='FATHER',
            is_primary=True,
        )

        SchoolNotificationConfig.objects.update_or_create(
            school=school,
            defaults={
                'in_app_enabled': True,
                'push_enabled': True,
                'transport_notification_enabled': True,
            },
        )

        route = TransportRoute.objects.create(
            school=school,
            name=f"{seed_data['prefix']}Route 1",
            description='Transport correctness route',
            start_location='Sector 1',
            end_location='School Campus',
            estimated_duration_minutes=35,
            is_active=True,
        )
        stop = TransportStop.objects.create(
            route=route,
            name=f"{seed_data['prefix']}Stop A",
            address='Main Road',
            stop_order=1,
            pickup_time=time(hour=7, minute=30),
            drop_time=time(hour=13, minute=45),
        )
        TransportAssignment.objects.create(
            school=school,
            academic_year=seed_data['academic_year'],
            student=student,
            route=route,
            stop=stop,
            transport_type='BOTH',
            is_active=True,
        )

        journey = RouteJourney.objects.create(
            school=school,
            route=route,
            journey_type='TO_SCHOOL',
            status='ACTIVE',
            tracking_mode='DRIVER_APP',
        )

        with patch(
            'notifications.engine.NotificationEngine._get_channel_handler',
            return_value=self._AlwaysSuccessHandler(),
        ):
            first = trigger_bus_arriving_stop(journey, stop)
            second = trigger_bus_arriving_stop(journey, stop)

        logs = NotificationLog.objects.filter(
            school=school,
            channel='PUSH',
            event_type='TRANSPORT_UPDATE',
            recipient_user=parent_user,
            student=student,
            title=f'Bus Arriving - {stop.name}',
        )

        assert first == 1
        assert second == 0
        assert logs.count() == 1

    def test_daily_school_report_dedupes_per_admin_per_day(self, seed_data):
        school = seed_data['school_a']
        target_date = date.today() + timedelta(days=1)

        SchoolNotificationConfig.objects.update_or_create(
            school=school,
            defaults={
                'in_app_enabled': True,
                'daily_report_enabled': True,
            },
        )

        first = trigger_daily_school_report(school, target_date)
        second = trigger_daily_school_report(school, target_date)

        expected_admins = UserSchoolMembership.objects.filter(
            school=school,
            is_active=True,
            role__in=[
                UserSchoolMembership.Role.SCHOOL_ADMIN,
                UserSchoolMembership.Role.PRINCIPAL,
            ],
        ).count()

        title = f"Daily Report — {target_date.strftime('%d %B %Y')}"
        logs = NotificationLog.objects.filter(
            school=school,
            channel='IN_APP',
            event_type='GENERAL',
            title=title,
        )

        assert first == expected_admins
        assert second == 0
        assert logs.count() == expected_admins
