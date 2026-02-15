"""
Expo Push Notification channel.
Sends push notifications via the Expo Push API.
"""

import logging
import requests
from .base import BaseChannel

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'


class ExpoChannel(BaseChannel):
    """Send push notifications via Expo Push API."""

    def send(self, recipient: str, title: str, body: str, metadata: dict = None) -> bool:
        """
        Send push notification to a specific user.

        Args:
            recipient: User ID (str) — used to look up push tokens.
            title: Notification title.
            body: Notification body.
            metadata: Extra context (log_id, etc.)

        Returns:
            True if at least one push was sent successfully.
        """
        from users.models import DevicePushToken

        try:
            user_id = int(recipient)
        except (ValueError, TypeError):
            logger.error(f"ExpoChannel: invalid recipient user ID: {recipient}")
            return False

        tokens = DevicePushToken.objects.filter(
            user_id=user_id, is_active=True,
        ).values_list('token', flat=True)

        if not tokens:
            logger.info(f"ExpoChannel: no active push tokens for user {user_id}")
            return False

        messages = [
            {
                'to': token,
                'title': title,
                'body': body,
                'sound': 'default',
                'data': metadata or {},
            }
            for token in tokens
        ]

        try:
            response = requests.post(
                EXPO_PUSH_URL,
                json=messages,
                headers={
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                },
                timeout=10,
            )
            response.raise_for_status()

            result = response.json()
            data = result.get('data', [])

            success_count = sum(1 for item in data if item.get('status') == 'ok')
            error_count = len(data) - success_count

            if error_count > 0:
                for item in data:
                    if item.get('status') == 'error':
                        error_msg = item.get('message', 'Unknown error')
                        details = item.get('details', {})
                        logger.warning(f"ExpoChannel push error: {error_msg} - {details}")
                        if details.get('error') == 'DeviceNotRegistered':
                            DevicePushToken.objects.filter(
                                token=item.get('details', {}).get('expoPushToken', ''),
                            ).update(is_active=False)

            return success_count > 0

        except requests.RequestException as e:
            logger.error(f"ExpoChannel: failed to send push notification: {e}")
            return False
