"""
Utilities for dispatching and tracking background Celery tasks.
"""

import logging
import uuid

from django.db import models
from django.utils import timezone

from .models import BackgroundTask

logger = logging.getLogger(__name__)


def dispatch_background_task(
    celery_task_func,
    task_type,
    title,
    school_id,
    user,
    task_args=(),
    task_kwargs=None,
    progress_total=0,
):
    """
    Create a BackgroundTask record and dispatch the Celery task.

    If Celery/Redis is unavailable, falls back to running the task
    synchronously so the operation still completes.

    Returns the BackgroundTask instance (with celery_task_id set).
    """
    task_kwargs = task_kwargs or {}

    # Check if Celery is in eager mode (local dev — tasks run synchronously)
    from django.conf import settings
    is_eager = getattr(settings, 'CELERY_TASK_ALWAYS_EAGER', False)

    if is_eager:
        # Eager mode: .delay() runs synchronously, so create the DB record
        # BEFORE dispatching so that progress/success updates find it.
        celery_task_id = str(uuid.uuid4())
        bg_task = BackgroundTask.objects.create(
            school_id=school_id,
            celery_task_id=celery_task_id,
            task_type=task_type,
            title=title,
            status=BackgroundTask.Status.IN_PROGRESS,
            progress_total=progress_total,
            triggered_by=user,
        )
        try:
            celery_task_func.apply(
                args=task_args, kwargs=task_kwargs, task_id=celery_task_id,
            )
        except Exception as task_exc:
            logger.exception(f"Eager task failed for '{title}'")
            mark_task_failed(celery_task_id, str(task_exc)[:500])
        logger.info(f"Dispatched background task {celery_task_id}: {title}")
        return bg_task

    try:
        result = celery_task_func.delay(*task_args, **task_kwargs)
        celery_task_id = result.id
    except Exception as e:
        logger.warning(f"Celery unavailable, running '{title}' synchronously: {e}")
        celery_task_id = f"sync-{uuid.uuid4()}"
        # Run synchronously — create the record first, then execute
        bg_task = BackgroundTask.objects.create(
            school_id=school_id,
            celery_task_id=celery_task_id,
            task_type=task_type,
            title=title,
            status=BackgroundTask.Status.IN_PROGRESS,
            progress_total=progress_total,
            triggered_by=user,
        )
        try:
            celery_task_func.apply(
                args=task_args, kwargs=task_kwargs, task_id=celery_task_id,
            )
        except Exception as task_exc:
            logger.exception(f"Sync fallback failed for '{title}'")
            mark_task_failed(celery_task_id, str(task_exc)[:500])
        return bg_task

    bg_task = BackgroundTask.objects.create(
        school_id=school_id,
        celery_task_id=celery_task_id,
        task_type=task_type,
        title=title,
        status=BackgroundTask.Status.PENDING,
        progress_total=progress_total,
        triggered_by=user,
    )

    logger.info(f"Dispatched background task {celery_task_id}: {title}")
    return bg_task


def run_task_sync(
    celery_task_func, task_type, title, school_id, user,
    task_kwargs=None, progress_total=0,
):
    """
    Run a Celery task synchronously with BackgroundTask tracking.

    Creates the BackgroundTask record first, then runs the task inline.
    Returns the refreshed BackgroundTask instance (with result_data).
    Raises on failure after marking the task as FAILED.
    """
    task_kwargs = task_kwargs or {}
    celery_task_id = str(uuid.uuid4())
    BackgroundTask.objects.create(
        school_id=school_id,
        celery_task_id=celery_task_id,
        task_type=task_type,
        title=title,
        status=BackgroundTask.Status.IN_PROGRESS,
        progress_total=progress_total,
        triggered_by=user,
    )
    try:
        celery_task_func.apply(kwargs=task_kwargs, task_id=celery_task_id)
    except Exception as e:
        logger.exception(f"Sync task failed for '{title}'")
        mark_task_failed(celery_task_id, str(e)[:500])
        raise
    return BackgroundTask.objects.get(celery_task_id=celery_task_id)


def update_task_progress(celery_task_id, current, total=None):
    """Update progress on a BackgroundTask. Called from within a Celery task."""
    updates = {
        'progress_current': current,
        'status': BackgroundTask.Status.IN_PROGRESS,
    }
    if total is not None:
        updates['progress_total'] = total

    BackgroundTask.objects.filter(celery_task_id=celery_task_id).update(**updates)


def mark_task_success(celery_task_id, result_data=None):
    """Mark a BackgroundTask as successfully completed."""
    BackgroundTask.objects.filter(celery_task_id=celery_task_id).update(
        status=BackgroundTask.Status.SUCCESS,
        progress_current=models.F('progress_total'),
        result_data=result_data,
        completed_at=timezone.now(),
    )


def mark_task_failed(celery_task_id, error_message):
    """Mark a BackgroundTask as failed."""
    BackgroundTask.objects.filter(celery_task_id=celery_task_id).update(
        status=BackgroundTask.Status.FAILED,
        error_message=error_message,
        completed_at=timezone.now(),
    )
