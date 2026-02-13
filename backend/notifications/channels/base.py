"""
Abstract base class for notification channels.
"""

from abc import ABC, abstractmethod


class BaseChannel(ABC):
    """All notification channels must implement send()."""

    def __init__(self, school):
        self.school = school

    @abstractmethod
    def send(self, recipient: str, title: str, body: str, metadata: dict = None) -> bool:
        """
        Send a single notification.

        Args:
            recipient: Phone number, user ID, email, etc.
            title: Notification title/subject
            body: Notification body/message
            metadata: Extra context (log_id, etc.)

        Returns:
            True if sent successfully
        """
        ...

    def is_configured(self) -> bool:
        """Check if this channel is properly configured for the school."""
        return True
