from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone

from notifications.models import NotificationLog
from notifications.tasks import process_notification_queue


@pytest.mark.django_db
class TestNotificationPhaseDObservability:

    def test_diagnostics_endpoint_returns_failed_reason_counts(self, seed_data, api):
        school = seed_data['school_a']
        admin_user = seed_data['users']['admin']

        NotificationLog.objects.create(
            school=school,
            channel='IN_APP',
            event_type='GENERAL',
            recipient_type='ADMIN',
            recipient_identifier=str(admin_user.id),
            recipient_user=admin_user,
            title='Failure A',
            body='Body A',
            status='FAILED',
            metadata={'reason_code': 'failed_dispatch', 'error': 'mock error a', 'retriable': True, 'retry_count': 1},
        )
        NotificationLog.objects.create(
            school=school,
            channel='IN_APP',
            event_type='GENERAL',
            recipient_type='ADMIN',
            recipient_identifier=str(admin_user.id),
            recipient_user=admin_user,
            title='Failure B',
            body='Body B',
            status='FAILED',
            metadata={'reason_code': 'failed_dispatch', 'error': 'mock error b', 'retriable': False, 'retry_count': 3},
        )

        resp = api.get('/api/notifications/diagnostics/', seed_data['tokens']['admin'], seed_data['SID_A'])
        assert resp.status_code == 200, f"diagnostics endpoint status={resp.status_code}"

        body = resp.json()
        assert body.get('failed_total') == 2
        assert body.get('failed_by_reason_code', {}).get('failed_dispatch') == 2
        assert 'queue' in body
        assert 'recent_failures' in body

    def test_diagnostics_teacher_forbidden(self, seed_data, api):
        resp = api.get('/api/notifications/diagnostics/', seed_data['tokens']['teacher'], seed_data['SID_A'])
        assert resp.status_code == 403, f"diagnostics teacher forbidden status={resp.status_code}"

    def test_process_queue_retries_only_retriable_failures(self, seed_data):
        school = seed_data['school_a']
        admin_user = seed_data['users']['admin']

        retriable_failed = NotificationLog.objects.create(
            school=school,
            channel='IN_APP',
            event_type='GENERAL',
            recipient_type='ADMIN',
            recipient_identifier=str(admin_user.id),
            recipient_user=admin_user,
            title='Retriable',
            body='Retriable body',
            status='FAILED',
            metadata={'reason_code': 'failed_dispatch', 'retriable': True, 'retry_count': 0},
        )
        non_retriable_failed = NotificationLog.objects.create(
            school=school,
            channel='IN_APP',
            event_type='GENERAL',
            recipient_type='ADMIN',
            recipient_identifier=str(admin_user.id),
            recipient_user=admin_user,
            title='Non Retriable',
            body='Non retriable body',
            status='FAILED',
            metadata={'reason_code': 'failed_dispatch', 'retriable': False, 'retry_count': 0},
        )

        cutoff_time = timezone.now() - timedelta(minutes=2)
        NotificationLog.objects.filter(id__in=[retriable_failed.id, non_retriable_failed.id]).update(created_at=cutoff_time)

        class SuccessHandler:
            def send(self, recipient, title, body):
                return True

        with patch('notifications.engine.NotificationEngine._get_channel_handler', return_value=SuccessHandler()):
            result = process_notification_queue()

        retriable_failed.refresh_from_db()
        non_retriable_failed.refresh_from_db()

        assert result.get('retried') == 1
        assert result.get('skipped_non_retriable') >= 1
        assert retriable_failed.status == 'SENT'
        assert non_retriable_failed.status == 'FAILED'
