"""
Utilities for dispatching and tracking background Celery tasks.

Set env var CELERY_FORCE_SYNC=true to run all background tasks synchronously
inside the web request, bypassing the Celery worker entirely.  This is the
recommended setting when you do not run a Celery worker (e.g. small deploys or
during migration away from Celery).
"""

import logging
import os
import time
import uuid

from django.db import models
from django.utils import timezone

from .models import BackgroundTask

logger = logging.getLogger(__name__)

# When True, dispatch_background_task always runs tasks inline (no Redis needed).
CELERY_FORCE_SYNC = os.getenv('CELERY_FORCE_SYNC', '').lower() in ('1', 'true', 'yes')

# When True, dispatch_background_task enqueues to a DB-backed queue (QueuedJob)
# instead of sending tasks to Celery.
DB_JOB_QUEUE_ENABLED = os.getenv('DB_JOB_QUEUE_ENABLED', '').lower() in ('1', 'true', 'yes')

# Cache worker availability to avoid pinging Redis on every request.
# Format: (timestamp, is_available)
_worker_cache = {'checked_at': 0.0, 'available': False}
_WORKER_CACHE_TTL = 30  # seconds


def _celery_worker_available():
    """
    Quick check whether at least one Celery worker is connected.

    Returns False immediately when CELERY_FORCE_SYNC is set so that
    dispatch_background_task always takes the sync path without touching Redis.
    Otherwise the result is cached for _WORKER_CACHE_TTL seconds.
    """
    if CELERY_FORCE_SYNC:
        return False

    now = time.monotonic()
    if now - _worker_cache['checked_at'] < _WORKER_CACHE_TTL:
        return _worker_cache['available']

    try:
        from config.celery import app as celery_app
        # ping() returns a list of dicts, one per worker: [{'worker1': {'ok': 'pong'}}]
        result = celery_app.control.ping(timeout=2.0)
        available = bool(result)
    except Exception:
        available = False

    _worker_cache['checked_at'] = now
    _worker_cache['available'] = available
    if not available:
        logger.warning("Celery worker ping failed — no active workers detected")
    return available


def _run_sync_fallback(celery_task_func, task_type, title, school_id, user,
                       task_args, task_kwargs, progress_total):
    """Create a BackgroundTask and run the Celery task synchronously."""
    celery_task_id = f"sync-{uuid.uuid4()}"
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

    If Celery/Redis is unavailable or no worker is running, falls back to
    running the task synchronously so the operation still completes.

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

    # Explicit sync mode takes precedence over DB queue mode.
    if CELERY_FORCE_SYNC:
        logger.warning(f"CELERY_FORCE_SYNC=true, running '{title}' synchronously")
        return _run_sync_fallback(
            celery_task_func, task_type, title, school_id, user,
            task_args, task_kwargs, progress_total,
        )

    # Optional DB-backed async queue (no Celery/Redis needed).
    if DB_JOB_QUEUE_ENABLED:
        celery_task_id = f"dbq-{uuid.uuid4()}"
        bg_task = BackgroundTask.objects.create(
            school_id=school_id,
            celery_task_id=celery_task_id,
            task_type=task_type,
            title=title,
            status=BackgroundTask.Status.PENDING,
            progress_total=progress_total,
            triggered_by=user,
        )

        from .job_queue import enqueue_background_job

        enqueue_background_job(
            background_task=bg_task,
            school_id=school_id,
            user=user,
            task_func=celery_task_func,
            task_args=task_args,
            task_kwargs=task_kwargs,
        )
        logger.info(f"Enqueued DB background task {celery_task_id}: {title}")
        return bg_task

    # Production: verify a worker is alive before dispatching to Celery.
    # .delay() succeeds as long as Redis is reachable, even if no worker
    # is running — the task would sit in the queue forever as PENDING.
    if not _celery_worker_available():
        logger.warning(f"No Celery worker available, running '{title}' synchronously")
        return _run_sync_fallback(
            celery_task_func, task_type, title, school_id, user,
            task_args, task_kwargs, progress_total,
        )

    try:
        result = celery_task_func.delay(*task_args, **task_kwargs)
        celery_task_id = result.id
    except Exception as e:
        logger.warning(f"Celery unavailable, running '{title}' synchronously: {e}")
        # Invalidate the worker cache so next dispatch re-checks
        _worker_cache['checked_at'] = 0.0
        return _run_sync_fallback(
            celery_task_func, task_type, title, school_id, user,
            task_args, task_kwargs, progress_total,
        )

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


def call_task(celery_task_func, *args, **kwargs):
    """
    Fire a Celery task in the background when a worker is available, or run
    it synchronously when CELERY_FORCE_SYNC is set or Redis is unreachable.

    Use this as a drop-in replacement for ``celery_task_func.delay(*args, **kwargs)``
    in places that do NOT need BackgroundTask progress tracking (e.g. signal
    handlers that trigger embedding updates or stats recomputes).

    Returns:
        True  — task was sent to Celery (async)
        False — task ran synchronously inside this process
    """
    if CELERY_FORCE_SYNC:
        try:
            celery_task_func(*args, **kwargs)
        except Exception:
            logger.exception("call_task sync execution failed: %s", celery_task_func.__name__)
        return False

    try:
        celery_task_func.delay(*args, **kwargs)
        return True
    except Exception as exc:
        logger.warning(
            "call_task: Celery unavailable (%s), running %s synchronously",
            exc,
            celery_task_func.__name__,
        )
        try:
            celery_task_func(*args, **kwargs)
        except Exception:
            logger.exception("call_task sync fallback failed: %s", celery_task_func.__name__)
        return False
