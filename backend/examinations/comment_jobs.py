"""
Background runs of AI comment generation, with no Celery/Redis.

The job runs in a daemon thread inside the web process (the same pattern the book
TOC OCR uses) and reports real progress through the existing BackgroundTask table.
Nothing is lost if the process restarts mid-run: every finished student's comments
are already saved and the generator skips existing comments, so running it again
simply continues.
"""

import logging
import threading
import uuid
from datetime import timedelta

from django.db import connection
from django.utils import timezone

from core.models import BackgroundTask

logger = logging.getLogger(__name__)

ACTIVE = (BackgroundTask.Status.PENDING, BackgroundTask.Status.IN_PROGRESS)
# A run that has not reported progress for this long is treated as dead (restart, crash).
STALE_AFTER = timedelta(seconds=120)


def _prefix(exam_id):
    return f'commentgen-{exam_id}-'


def latest_job(exam_id, school_id):
    """Most recent run for this exam; a silent, unfinished run is closed as failed."""
    task = BackgroundTask.objects.filter(
        school_id=school_id, celery_task_id__startswith=_prefix(exam_id),
    ).order_by('-created_at').first()
    if task and task.status in ACTIVE and timezone.now() - task.updated_at > STALE_AFTER:
        BackgroundTask.objects.filter(pk=task.pk).update(
            status=BackgroundTask.Status.FAILED,
            error_message='Generation stopped unexpectedly (the server may have restarted). '
                          'Press Generate again to continue where it left off.',
            completed_at=timezone.now(),
        )
        task.refresh_from_db()
    return task


def start_job(exam, school_id, user):
    """Start a run, or return the one already running for this exam. -> (task, started)"""
    existing = latest_job(exam.id, school_id)
    if existing and existing.status in ACTIVE:
        return existing, False
    task = BackgroundTask.objects.create(
        school_id=school_id,
        celery_task_id=f'{_prefix(exam.id)}{uuid.uuid4()}',
        task_type=BackgroundTask.TaskType.REPORT_GENERATION,
        title=f'Report card comments: {exam.name}',
        status=BackgroundTask.Status.IN_PROGRESS,
        progress_total=0,
        result_data={},
        triggered_by=user,
    )
    threading.Thread(
        target=_run, args=(task.celery_task_id, exam.id, school_id), daemon=True,
    ).start()
    return task, True


def request_cancel(exam_id, school_id):
    task = latest_job(exam_id, school_id)
    if not task or task.status not in ACTIVE:
        return None
    data = dict(task.result_data or {})
    data['cancel_requested'] = True
    BackgroundTask.objects.filter(pk=task.pk).update(result_data=data, updated_at=timezone.now())
    task.refresh_from_db()
    return task


def job_payload(task):
    if not task:
        return {'status': 'NONE'}
    end = task.completed_at or timezone.now()
    data = task.result_data or {}
    return {
        'task_id': task.celery_task_id,
        'status': task.status,
        'current': task.progress_current,
        'total': task.progress_total,
        'elapsed_seconds': max(0, (end - task.created_at).total_seconds()),
        'cancel_requested': bool(data.get('cancel_requested')),
        'result': data if task.status == BackgroundTask.Status.SUCCESS else None,
        'error': task.error_message or None,
    }


def _run(task_id, exam_id, school_id):
    """Thread body: uses its own DB connection and always closes it."""
    from schools.models import School
    from .ai_comments_service import ReportCardCommentGenerator

    tasks = BackgroundTask.objects.filter(celery_task_id=task_id)

    def on_progress(done, total):
        tasks.update(progress_current=done, progress_total=total, updated_at=timezone.now())

    def should_cancel():
        data = tasks.values_list('result_data', flat=True).first() or {}
        return bool(data.get('cancel_requested'))

    try:
        school = School.objects.get(id=school_id)
        result = ReportCardCommentGenerator(school).generate_for_exam(
            exam_id, on_progress=on_progress, should_cancel=should_cancel,
        )
        if result.get('error'):
            tasks.update(
                status=BackgroundTask.Status.FAILED, error_message=result['error'],
                completed_at=timezone.now(),
            )
        else:
            tasks.update(
                status=BackgroundTask.Status.SUCCESS, result_data=result,
                completed_at=timezone.now(),
            )
    except Exception as exc:
        logger.exception('Comment generation job failed for exam %s', exam_id)
        tasks.update(
            status=BackgroundTask.Status.FAILED, error_message=str(exc)[:500],
            completed_at=timezone.now(),
        )
    finally:
        connection.close()
