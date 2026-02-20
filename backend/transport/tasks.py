"""
Celery tasks for transport GPS data maintenance.
"""

import logging
from celery import shared_task
from django.utils import timezone
from datetime import timedelta

logger = logging.getLogger(__name__)


@shared_task
def cleanup_old_location_data(days=7):
    """Delete GPS location updates older than `days` days for completed journeys."""
    from .models import LocationUpdate, StudentJourney

    cutoff = timezone.now() - timedelta(days=days)
    old_locations = LocationUpdate.objects.filter(
        journey__status='COMPLETED',
        timestamp__lt=cutoff,
    )
    count = old_locations.count()
    old_locations.delete()
    logger.info(f"Cleaned up {count} old location updates (older than {days} days)")
    return count


@shared_task
def auto_end_stale_journeys(hours=2):
    """Auto-end journeys that have been active for more than `hours` hours."""
    from .models import StudentJourney

    cutoff = timezone.now() - timedelta(hours=hours)
    stale = StudentJourney.objects.filter(
        status='ACTIVE',
        started_at__lt=cutoff,
    )
    count = stale.count()
    stale.update(status='COMPLETED', ended_at=timezone.now())
    logger.info(f"Auto-ended {count} stale journeys (active for more than {hours} hours)")
    return count


@shared_task
def cleanup_old_route_location_data(days=7):
    """Delete GPS location updates older than `days` days for completed route journeys."""
    from .models import RouteLocationUpdate

    cutoff = timezone.now() - timedelta(days=days)
    old_locations = RouteLocationUpdate.objects.filter(
        journey__status='COMPLETED',
        timestamp__lt=cutoff,
    )
    count = old_locations.count()
    old_locations.delete()
    logger.info(f"Cleaned up {count} old route location updates (older than {days} days)")
    return count


@shared_task
def auto_end_stale_route_journeys(hours=2):
    """Auto-end route journeys that have been active for more than `hours` hours."""
    from .models import RouteJourney

    cutoff = timezone.now() - timedelta(hours=hours)
    stale = RouteJourney.objects.filter(
        status='ACTIVE',
        started_at__lt=cutoff,
    )
    count = stale.count()
    stale.update(status='COMPLETED', ended_at=timezone.now())
    logger.info(f"Auto-ended {count} stale route journeys (active for more than {hours} hours)")
    return count
