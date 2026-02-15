"""
Core notification dispatch engine.
Renders templates, checks preferences, dispatches to channels, and logs results.
"""

import logging
from typing import Optional
from django.utils import timezone

logger = logging.getLogger(__name__)


class NotificationEngine:
    """
    Central engine for sending notifications through any channel.

    Usage:
        engine = NotificationEngine(school)
        engine.send(
            event_type='ABSENCE',
            channel='WHATSAPP',
            context={'student_name': 'Ali', 'class_name': '5-A', 'date': '2025-01-15'},
            recipient_identifier='+923001234567',
            recipient_type='PARENT',
            student=student_obj,
        )
    """

    def __init__(self, school):
        self.school = school

    def _get_template(self, event_type: str, channel: str):
        """Find the best matching template (school-specific first, then system default)."""
        from .models import NotificationTemplate

        # Try school-specific template first
        template = NotificationTemplate.objects.filter(
            school=self.school,
            event_type=event_type,
            channel=channel,
            is_active=True,
        ).first()

        if not template:
            # Fall back to system-wide default
            template = NotificationTemplate.objects.filter(
                school__isnull=True,
                event_type=event_type,
                channel=channel,
                is_active=True,
            ).first()

        return template

    def _check_preference(self, event_type: str, channel: str,
                          user=None, student=None) -> bool:
        """Check if the recipient has opted out of this notification type."""
        from .models import NotificationPreference

        filters = {
            'school': self.school,
            'channel': channel,
            'event_type': event_type,
        }

        if user:
            filters['user'] = user
        elif student:
            filters['student'] = student
        else:
            return True  # No preference record = allowed

        pref = NotificationPreference.objects.filter(**filters).first()
        if pref is None:
            return True  # No preference = default enabled
        return pref.is_enabled

    def _check_config(self, channel: str) -> bool:
        """Check if the channel is enabled in school notification config."""
        from .models import SchoolNotificationConfig

        try:
            config = self.school.notification_config
        except SchoolNotificationConfig.DoesNotExist:
            # No config = use defaults (in_app enabled, others disabled)
            return channel == 'IN_APP'

        channel_map = {
            'WHATSAPP': config.whatsapp_enabled,
            'SMS': config.sms_enabled,
            'IN_APP': config.in_app_enabled,
            'EMAIL': config.email_enabled,
            'PUSH': config.push_enabled,
        }
        return channel_map.get(channel, False)

    def _get_channel_handler(self, channel: str):
        """Get the channel handler for dispatching."""
        from .channels.whatsapp import WhatsAppChannel
        from .channels.in_app import InAppChannel
        from .channels.expo import ExpoChannel

        handlers = {
            'WHATSAPP': WhatsAppChannel,
            'IN_APP': InAppChannel,
            'PUSH': ExpoChannel,
        }
        handler_class = handlers.get(channel)
        if handler_class:
            return handler_class(self.school)
        return None

    def _create_log(self, **kwargs):
        """Create a NotificationLog entry."""
        from .models import NotificationLog
        return NotificationLog.objects.create(school=self.school, **kwargs)

    def send(
        self,
        event_type: str,
        channel: str,
        context: dict,
        recipient_identifier: str,
        recipient_type: str = 'PARENT',
        recipient_user=None,
        student=None,
        title: str = '',
        body: str = '',
    ) -> Optional['NotificationLog']:
        """
        Send a single notification.

        Args:
            event_type: One of the EVENT_TYPE_CHOICES
            channel: One of the CHANNEL_CHOICES
            context: Dict of placeholder values for template rendering
            recipient_identifier: Phone, email, or user ID
            recipient_type: PARENT, STAFF, or ADMIN
            recipient_user: User object (for in-app notifications)
            student: Student object (for student-related notifications)
            title: Override title (skips template rendering for title)
            body: Override body (skips template rendering entirely)

        Returns:
            NotificationLog entry or None if skipped
        """
        from .models import NotificationLog

        # Check channel is enabled for school
        if not self._check_config(channel):
            logger.info(f"Channel {channel} disabled for school {self.school.name}")
            return None

        # Check recipient preference
        if not self._check_preference(event_type, channel,
                                       user=recipient_user, student=student):
            logger.info(f"Notification opted out: {event_type}/{channel} for {recipient_identifier}")
            return None

        # Render message from template if body not provided
        if not body:
            template = self._get_template(event_type, channel)
            if template:
                rendered = template.render(context)
                title = title or rendered['subject']
                body = rendered['body']
            else:
                logger.warning(f"No template found for {event_type}/{channel}")
                return None
        else:
            template = None

        # Create log entry
        log = self._create_log(
            template=template,
            channel=channel,
            event_type=event_type,
            recipient_type=recipient_type,
            recipient_identifier=recipient_identifier,
            recipient_user=recipient_user,
            student=student,
            title=title,
            body=body,
            status='PENDING',
        )

        # Dispatch to channel handler
        handler = self._get_channel_handler(channel)
        if not handler:
            log.status = 'FAILED'
            log.metadata = {'error': f'No handler for channel: {channel}'}
            log.save(update_fields=['status', 'metadata'])
            return log

        try:
            success = handler.send(
                recipient=recipient_identifier,
                title=title,
                body=body,
                metadata={'log_id': log.id},
            )
            if success:
                log.status = 'SENT'
                log.sent_at = timezone.now()
            else:
                log.status = 'FAILED'
                log.metadata = {'error': 'Channel handler returned False'}
        except Exception as e:
            log.status = 'FAILED'
            log.metadata = {'error': str(e)}
            logger.error(f"Notification dispatch failed: {e}")

        log.save(update_fields=['status', 'sent_at', 'metadata'])
        return log

    def send_bulk(
        self,
        event_type: str,
        channel: str,
        recipients: list,
    ) -> dict:
        """
        Send notifications to multiple recipients.

        Args:
            event_type: Event type
            channel: Channel to use
            recipients: List of dicts with keys:
                - recipient_identifier (str)
                - context (dict)
                - recipient_type (str, default 'PARENT')
                - recipient_user (User, optional)
                - student (Student, optional)

        Returns:
            dict: {'sent': int, 'failed': int, 'skipped': int}
        """
        sent = 0
        failed = 0
        skipped = 0

        for r in recipients:
            log = self.send(
                event_type=event_type,
                channel=channel,
                context=r.get('context', {}),
                recipient_identifier=r['recipient_identifier'],
                recipient_type=r.get('recipient_type', 'PARENT'),
                recipient_user=r.get('recipient_user'),
                student=r.get('student'),
            )
            if log is None:
                skipped += 1
            elif log.status == 'SENT':
                sent += 1
            else:
                failed += 1

        return {'sent': sent, 'failed': failed, 'skipped': skipped}
