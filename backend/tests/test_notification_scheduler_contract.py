from datetime import datetime, time
from unittest.mock import patch

import pytest
from django.conf import settings
from django.core.management import call_command
from django.utils import timezone
from django_celery_beat.models import PeriodicTask

from notifications.models import SchoolNotificationConfig
from notifications.tasks import send_daily_absence_summary


def _aware(year, month, day, hour, minute):
    naive = datetime(year, month, day, hour, minute)
    return timezone.make_aware(naive, timezone.get_current_timezone())


@pytest.mark.django_db
class TestNotificationSchedulerContract:

    def test_code_schedule_no_longer_includes_business_notification_jobs(self):
        # Fee-pending, daily report, absence digest, and the 11am attendance
        # reminder are event-driven / admin-triggered now (see
        # RunNotificationJobView, attendance.views.bulk_entry,
        # finance.tasks.generate_monthly_fees_task) — none of them should be
        # on Celery Beat any more.
        removed_names = (
            'scheduled-absence-in-app-digest',
            'daily-absence-summary',
            'fee-pending-in-app-5th',
            'fee-pending-in-app-8th',
            'class-teacher-attendance-reminder-11am',
        )
        for name in removed_names:
            assert settings.CELERY_BEAT_SCHEDULE.get(name) is None

    def test_sync_scheduler_command_disables_removed_business_notification_jobs(self):
        from django_celery_beat.models import CrontabSchedule

        crontab_row, _ = CrontabSchedule.objects.get_or_create(
            minute='0', hour='8,9,10', day_of_week='*', day_of_month='*', month_of_year='*',
        )
        PeriodicTask.objects.update_or_create(
            name='scheduled-absence-in-app-digest',
            defaults={
                'task': 'notifications.tasks.run_scheduled_absence_in_app_digest',
                'crontab': crontab_row,
                'enabled': True,
            },
        )

        call_command('sync_notification_scheduler')

        task = PeriodicTask.objects.get(name='scheduled-absence-in-app-digest')
        assert task.enabled is False

    def test_daily_report_respects_configured_time(self, seed_data):
        school_a = seed_data['school_a']
        school_b = seed_data['school_b']

        SchoolNotificationConfig.objects.update_or_create(
            school=school_a,
            defaults={
                'daily_report_enabled': True,
                'daily_absence_summary_time': time(hour=14, minute=25),
            },
        )
        SchoolNotificationConfig.objects.update_or_create(
            school=school_b,
            defaults={
                'daily_report_enabled': True,
                'daily_absence_summary_time': time(hour=16, minute=0),
            },
        )

        with patch('notifications.tasks.timezone.localtime', return_value=_aware(2026, 4, 10, 14, 25)):
            with patch('notifications.triggers.trigger_daily_school_report', return_value=2) as mock_trigger:
                send_daily_absence_summary()

        assert mock_trigger.call_count == 1
        called_school, called_date = mock_trigger.call_args[0]
        assert called_school == school_a
        assert str(called_date) == '2026-04-10'

    def test_daily_report_skips_when_toggle_disabled(self, seed_data):
        school_a = seed_data['school_a']

        SchoolNotificationConfig.objects.update_or_create(
            school=school_a,
            defaults={
                'daily_report_enabled': False,
                'daily_absence_summary_time': time(hour=14, minute=25),
            },
        )

        with patch('notifications.tasks.timezone.localtime', return_value=_aware(2026, 4, 10, 14, 25)):
            with patch('notifications.triggers.trigger_daily_school_report') as mock_trigger:
                send_daily_absence_summary()

        assert mock_trigger.call_count == 0
