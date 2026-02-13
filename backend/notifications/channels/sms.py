"""
SMS notification channel (stub for future implementation).
"""

import logging
from .base import BaseChannel

logger = logging.getLogger(__name__)


class SMSChannel(BaseChannel):
    """SMS channel stub - ready for provider integration."""

    def is_configured(self) -> bool:
        return False  # Not yet configured

    def send(self, recipient: str, title: str, body: str, metadata: dict = None) -> bool:
        logger.warning("SMS channel not yet implemented")
        return False
