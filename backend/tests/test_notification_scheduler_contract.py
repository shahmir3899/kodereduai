from datetime import datetime, time
from unittest.mock import patch

import pytest
from django.conf import settings
from django.core.management import call_command
from django.utils import timezone
from django_celery_beat.models import PeriodicTask

from notifications.models import SchoolNotificationConfig
from notifications.tasks import send_daily_absence_summary, send_fee_reminders


def _aware(year, month, day, hour, minute):
    naive = datetime(year, month, day, hour, minute)
    return timezone.make_aware(naive, timezone.get_current_timezone())


@pytest.mark.django_db
class TestNotificationSchedulerContract:

    def test_code_schedule_includes_absence_digest_task(self):
        entry = settings.CELERY_BEAT_SCHEDULE.get('scheduled-absence-in-app-digest')
        assert entry is not None
        assert entry.get('task') == 'notifications.tasks.run_scheduled_absence_in_app_digest'

    def test_sync_scheduler_command_upserts_absence_digest_periodic_task(self):
        # Validate create path.
        PeriodicTask.objects.filter(name='scheduled-absence-in-app-digest').delete()
        call_command('sync_notification_scheduler')

        task = PeriodicTask.objects.get(name='scheduled-absence-in-app-digest')
        assert task.task == 'notifications.tasks.run_scheduled_absence_in_app_digest'
        assert task.enabled is True
        assert task.crontab is not None
        assert task.crontab.minute == '0'
        assert task.crontab.hour == '8,9,10'

        # Validate idempotent update path.
        call_command('sync_notification_scheduler')
        assert PeriodicTask.objects.filter(name='scheduled-absence-in-app-digest').count() == 1

    def test_fee_reminders_respect_fee_reminder_day(self, seed_data):
        school_a = seed_data['school_a']
        school_b = seed_data['school_b']

        SchoolNotificationConfig.objects.update_or_create(
            school=school_a,
            defaults={
                'whatsapp_enabled': False,
                'in_app_enabled': True,
                'fee_reminder_enabled': True,
                'fee_reminder_day': 10,
            },
        )
        SchoolNotificationConfig.objects.update_or_create(
            school=school_b,
            defaults={
                'whatsapp_enabled': False,
                'in_app_enabled': True,
                'fee_reminder_enabled': True,
                'fee_reminder_day': 11,
            },
        )

        with patch('notifications.tasks.timezone.now', return_value=_aware(2026, 4, 10, 9, 0)):
            with patch('notifications.triggers.trigger_fee_reminder') as mock_trigger:
                send_fee_reminders()

        assert mock_trigger.call_count == 1
        called_school, called_month, called_year = mock_trigger.call_args[0]
        assert called_school == school_a
        assert called_month == 4
        assert called_year == 2026

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
