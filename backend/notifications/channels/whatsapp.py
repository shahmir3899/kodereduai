"""
WhatsApp notification channel.
Delegates to WhatsApp Business API.
"""

import logging
import requests
from django.conf import settings
from .base import BaseChannel

logger = logging.getLogger(__name__)


class WhatsAppChannel(BaseChannel):
    """Send notifications via WhatsApp Business API."""

    def __init__(self, school):
        super().__init__(school)
        self.api_url = settings.WHATSAPP_API_URL
        self.api_key = settings.WHATSAPP_API_KEY
        self.sender_id = school.whatsapp_sender_id

    def is_configured(self) -> bool:
        return bool(self.api_url and self.api_key and self.sender_id)

    def send(self, recipient: str, title: str, body: str, metadata: dict = None) -> bool:
        if not self.is_configured():
            logger.warning(f"WhatsApp not configured for school {self.school.name}")
            return False

        if not recipient:
            logger.warning("No recipient phone number provided")
            return False

        try:
            response = requests.post(
                self.api_url,
                json={
                    'sender_id': self.sender_id,
                    'phone': recipient,
                    'message': body,
                },
                headers={
                    'Authorization': f'Bearer {self.api_key}',
                    'Content-Type': 'application/json',
                },
                timeout=30,
            )

            if response.status_code == 200:
                logger.info(f"WhatsApp sent to {recipient}")
                return True
            else:
                logger.error(f"WhatsApp API error: {response.status_code} - {response.text}")
                return False

        except Exception as e:
            logger.error(f"WhatsApp send failed: {e}")
            return False
