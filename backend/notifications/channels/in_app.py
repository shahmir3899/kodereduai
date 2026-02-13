"""
In-App notification channel.
Creates NotificationLog entries that the frontend reads via polling or WebSocket.
"""

import logging
from .base import BaseChannel

logger = logging.getLogger(__name__)


class InAppChannel(BaseChannel):
    """
    In-App channel: notifications are stored in NotificationLog
    and displayed via the frontend notification bell.

    The 'send' method here is a no-op since the NotificationEngine
    already creates the log entry. We just return True to indicate success.
    The log status is updated to SENT by the engine.
    """

    def is_configured(self) -> bool:
        return True  # Always available

    def send(self, recipient: str, title: str, body: str, metadata: dict = None) -> bool:
        # In-app notifications are already persisted as NotificationLog by the engine.
        # This handler just confirms delivery.
        logger.info(f"In-app notification created for user {recipient}")
        return True
