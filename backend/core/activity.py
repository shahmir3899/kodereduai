"""
"Seen today" marker behind the teacher performance report's login-days measure.

Written on sign-in and on every token refresh. A refresh happens about once an hour per open
session in production, so the cache check keeps it to one insert per user per day; the unique
constraint makes a cache miss harmless.
"""

import logging

from django.core.cache import cache

logger = logging.getLogger(__name__)


def record_active_day(user_id, school_id=None):
    """Mark the user as active today (school calendar). Never raises: it is a side effect of auth."""
    if not user_id:
        return
    try:
        from core.models import UserActiveDay
        from core.school_time import school_today

        today = school_today(school_id)
        key = f'active_day:{user_id}:{today.isoformat()}'
        if cache.get(key):
            return
        UserActiveDay.objects.bulk_create(
            [UserActiveDay(user_id=user_id, school_id=school_id, date=today)],
            ignore_conflicts=True,
        )
        cache.set(key, 1, 60 * 60 * 26)
    except Exception:
        logger.exception('Failed to record active day for user_id=%s', user_id)
