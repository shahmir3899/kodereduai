"""DB-backed async job queue helpers."""

import importlib
import logging
from datetime import timedelta

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from .models import BackgroundTask, QueuedJob

logger = logging.getLogger(__name__)


def resolve_callable_path(task_func):
    """Resolve a stable import path for a callable/Celery task object."""
    task_name = getattr(task_func, 'name', None)
    if task_name and '.' in task_name:
        return task_name

    module_name = getattr(task_func, '__module__', '')
    func_name = getattr(task_func, '__name__', '')
    if module_name and func_name:
        return f"{module_name}.{func_name}"

    raise ValueError(f"Cannot resolve callable path for {task_func!r}")


def load_callable(callable_path):
    """Load a callable from 'module.symbol' style path."""
    module_name, symbol_name = callable_path.rsplit('.', 1)
    module = importlib.import_module(module_name)
    return getattr(module, symbol_name)


def enqueue_background_job(*, background_task, school_id, user, task_func, task_args, task_kwargs, priority=100):
    """Create a DB queue record linked to the provided BackgroundTask."""
    callable_path = resolve_callable_path(task_func)
    return QueuedJob.objects.create(
        school_id=school_id,
        background_task=background_task,
        triggered_by=user,
        callable_path=callable_path,
        task_args=list(task_args or ()),
        task_kwargs=dict(task_kwargs or {}),
        priority=priority,
        status=QueuedJob.Status.PENDING,
    )


def claim_next_job(*, lease_seconds=300):
    """Claim one pending job with row-level locking."""
    now = timezone.now()
    lease_until = now + timedelta(seconds=lease_seconds)

    with transaction.atomic():
        job = (
            QueuedJob.objects.select_for_update(skip_locked=True)
            .filter(
                status=QueuedJob.Status.PENDING,
                scheduled_for__lte=now,
            )
            .order_by('priority', 'scheduled_for', 'id')
            .first()
        )

        if not job:
            return None

        QueuedJob.objects.filter(id=job.id).update(
            status=QueuedJob.Status.RUNNING,
            attempt_count=F('attempt_count') + 1,
            locked_at=now,
            lock_expires_at=lease_until,
            last_heartbeat_at=now,
        )
        job.refresh_from_db()

        if not job.started_at:
            job.started_at = now
            job.save(update_fields=['started_at', 'updated_at'])

        BackgroundTask.objects.filter(id=job.background_task_id).update(
            status=BackgroundTask.Status.IN_PROGRESS,
        )

        return job


def heartbeat(job):
    """Extend the lease for a running job."""
    now = timezone.now()
    QueuedJob.objects.filter(id=job.id, status=QueuedJob.Status.RUNNING).update(
        last_heartbeat_at=now,
    )


def complete_job(job, *, success, error_message=''):
    """Mark a job terminal and mirror status to BackgroundTask when needed."""
    now = timezone.now()

    if success:
        QueuedJob.objects.filter(id=job.id).update(
            status=QueuedJob.Status.SUCCESS,
            completed_at=now,
            locked_at=None,
            lock_expires_at=None,
            last_error='',
        )
        return

    if job.attempt_count >= job.max_attempts:
        from .task_utils import mark_task_failed

        QueuedJob.objects.filter(id=job.id).update(
            status=QueuedJob.Status.FAILED,
            completed_at=now,
            locked_at=None,
            lock_expires_at=None,
            last_error=error_message[:2000],
        )
        mark_task_failed(job.background_task.celery_task_id, error_message[:500])
        return

    # Exponential backoff with a soft cap to prevent tight retry loops.
    backoff_seconds = min(300, 5 * (2 ** max(0, job.attempt_count - 1)))
    QueuedJob.objects.filter(id=job.id).update(
        status=QueuedJob.Status.PENDING,
        scheduled_for=now + timedelta(seconds=backoff_seconds),
        locked_at=None,
        lock_expires_at=None,
        last_error=error_message[:2000],
    )


def cancel_queued_job(celery_task_id):
    """Best-effort cancellation for queued/running DB jobs."""
    return QueuedJob.objects.filter(
        background_task__celery_task_id=celery_task_id,
        status__in=[QueuedJob.Status.PENDING, QueuedJob.Status.RUNNING],
    ).update(
        status=QueuedJob.Status.CANCELLED,
        completed_at=timezone.now(),
        locked_at=None,
        lock_expires_at=None,
        last_error='Cancelled by user',
    )


def requeue_stale_running_jobs():
    """Move expired RUNNING jobs back to PENDING for retry."""
    now = timezone.now()
    return QueuedJob.objects.filter(
        status=QueuedJob.Status.RUNNING,
        lock_expires_at__lt=now,
    ).update(
        status=QueuedJob.Status.PENDING,
        locked_at=None,
        lock_expires_at=None,
        last_error='Job lease expired; re-queued for retry.',
    )


def execute_job(job):
    """Execute one claimed job and transition status."""
    job.refresh_from_db(fields=['status'])
    if job.status == QueuedJob.Status.CANCELLED:
        return False

    task_func = load_callable(job.callable_path)
    task_id = job.background_task.celery_task_id

    try:
        if hasattr(task_func, 'apply'):
            task_func.apply(args=tuple(job.task_args or ()), kwargs=job.task_kwargs or {}, task_id=task_id)
        else:
            task_func(*(job.task_args or ()), **(job.task_kwargs or {}))
        complete_job(job, success=True)
        return True
    except Exception as exc:
        logger.exception("DB job failed: %s", job.callable_path)
        complete_job(job, success=False, error_message=str(exc))
        return False
