"""
WhatsApp notification channel.
Supports legacy HTTP gateway or self-hosted WAHA (see core.whatsapp_delivery).
"""

import logging

from core.whatsapp_delivery import send_whatsapp, whatsapp_is_configured
from .base import BaseChannel

logger = logging.getLogger(__name__)


class WhatsAppChannel(BaseChannel):
    """Send notifications via configured WhatsApp provider."""

    def is_configured(self) -> bool:
        return whatsapp_is_configured(self.school, require_whatsapp_module=False)

    def send(self, recipient: str, title: str, body: str, metadata: dict = None) -> bool:
        if not self.is_configured():
            logger.warning(f"WhatsApp not configured for school {self.school.name}")
            return False

        if not recipient:
            logger.warning("No recipient phone number provided")
            return False

        return send_whatsapp(self.school, recipient, body, title=title)
