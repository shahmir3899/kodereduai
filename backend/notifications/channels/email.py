"""
Email notification channel.
Sends emails via Django's configured email backend.
"""

import logging

from django.conf import settings
from django.core.mail import send_mail

from .base import BaseChannel

logger = logging.getLogger(__name__)


class EmailChannel(BaseChannel):
    """Send notifications via SMTP/email backend configured in Django settings."""

    def is_configured(self) -> bool:
        return bool(getattr(settings, 'DEFAULT_FROM_EMAIL', '').strip())

    def send(self, recipient: str, title: str, body: str, metadata: dict = None) -> bool:
        if not self.is_configured():
            logger.warning("Email channel not configured: DEFAULT_FROM_EMAIL missing")
            return False
        if not recipient or '@' not in recipient:
            logger.warning("Invalid email recipient: %s", recipient)
            return False

        subject = title or "Notification"
        from_email = settings.DEFAULT_FROM_EMAIL

        try:
            sent_count = send_mail(
                subject=subject,
                message=body or "",
                from_email=from_email,
                recipient_list=[recipient],
                fail_silently=False,
            )
            return sent_count > 0
        except Exception as exc:
            logger.error("Email send failed for %s: %s", recipient, exc)
            return False
