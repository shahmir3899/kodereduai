"""Celery tasks for the assistant's learning loop. Both are on Beat (see CELERY_BEAT_SCHEDULE)."""
import logging

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)

CHUNK = 1000


@shared_task(ignore_result=True)
def cleanup_expired_gaps():
    """Retention: delete gap rows past `delete_after` (90 days). In chunks so Supabase is never locked for long."""
    from .models import AgentGap

    deleted = 0
    while True:
        ids = list(AgentGap.objects.filter(delete_after__lte=timezone.now()).values_list('pk', flat=True)[:CHUNK])
        if not ids:
            break
        deleted += AgentGap.objects.filter(pk__in=ids).delete()[0]
    logger.info('assistant gap cleanup deleted %s rows', deleted)
    return deleted


@shared_task(ignore_result=True)
def group_new_gaps():
    """Weekly: attach new, redacted gap summaries to groups (see assistant/grouping.py)."""
    from . import grouping

    result = grouping.run()
    logger.info('assistant gap grouping: %s', {k: v for k, v in result.items() if k != 'plan'})
    return {k: v for k, v in result.items() if k != 'plan'}
