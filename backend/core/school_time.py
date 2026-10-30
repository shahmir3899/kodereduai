"""
One place for "what time is it for this school".

Each School has its own time zone (School.timezone, default Asia/Karachi). Django already
runs in Asia/Karachi, so code written as ``timezone.localdate()`` / ``timezone.localtime()``
follows the *active* zone. TenantMiddleware activates the school's zone for every request
(from the X-School-ID header), so API code gets the school's clock without passing anything.

Outside a request (Celery tasks, management commands) the active zone is the project default.
A job that works for one school should wrap its work in ``school_timezone(school_id)``.
"""
from contextlib import contextmanager
from datetime import datetime, date
from zoneinfo import ZoneInfo, available_timezones

from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.utils import timezone

DEFAULT_TIMEZONE = 'Asia/Karachi'
_CACHE_SECONDS = 60


def validate_timezone_name(value):
    """Reject anything that is not a real IANA zone name."""
    if value not in available_timezones():
        raise ValidationError(f"'{value}' is not a valid time zone name.")


def _cache_key(school_id):
    return f'school-tz:{school_id}'


def school_timezone_name(school_id):
    """The school's zone name; the default when the school is unknown. Cached for a minute so the
    middleware does not add a query to every request."""
    if not school_id:
        return DEFAULT_TIMEZONE
    key = _cache_key(school_id)
    name = cache.get(key)
    if name is None:
        from schools.models import School
        name = School.objects.filter(id=school_id).values_list('timezone', flat=True).first() or DEFAULT_TIMEZONE
        cache.set(key, name, _CACHE_SECONDS)
    return name


def forget_school_timezone(school_id):
    cache.delete(_cache_key(school_id))


def school_tzinfo(school_id):
    return ZoneInfo(school_timezone_name(school_id))


def school_now(school_id=None) -> datetime:
    """Current time as an aware datetime in the school's zone (the active zone when no school is given)."""
    if school_id is None:
        return timezone.localtime()
    return timezone.now().astimezone(school_tzinfo(school_id))


def school_today(school_id=None) -> date:
    """Today's date on the school's calendar."""
    return school_now(school_id).date()


@contextmanager
def school_timezone(school_id):
    """Run a block with the school's zone active (for Celery tasks and scripts)."""
    with timezone.override(school_tzinfo(school_id)):
        yield
