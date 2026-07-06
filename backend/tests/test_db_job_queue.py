import pytest
import uuid
from datetime import timedelta
from io import StringIO
from django.core.management import call_command
from django.utils import timezone

from core.job_queue import (
    cancel_queued_job,
    claim_next_job,
    complete_job,
    enqueue_background_job,
    execute_job,
    requeue_stale_running_jobs,
)
from core.models import BackgroundTask, QueuedJob
from core.task_utils import mark_task_success
from schools.models import School


# ---------------------------------------------------------------------------
# Test callables used by execute_job via import path resolution.
# ---------------------------------------------------------------------------
def success_job(task_id):
    mark_task_success(task_id, result_data={'ok': True})
    return {'ok': True}


def failing_job(task_id):
    raise RuntimeError('boom')


@pytest.mark.django_db
class TestDbJobQueue:
    def _make_school(self):
        return School.objects.create(name='Queue Test School', subdomain=f'queue-{uuid.uuid4().hex[:12]}')

    def _make_background_task(self, school, task_id='dbq-test-1'):
        return BackgroundTask.objects.create(
            school=school,
            celery_task_id=task_id,
            task_type=BackgroundTask.TaskType.REPORT_GENERATION,
            title='Queue test task',
            status=BackgroundTask.Status.PENDING,
            progress_total=3,
            triggered_by=None,
        )

    def test_enqueue_and_claim_job(self):
        school = self._make_school()
        bg = self._make_background_task(school, task_id='dbq-test-claim')

        job = enqueue_background_job(
            background_task=bg,
            school_id=school.id,
            user=None,
            task_func=success_job,
            task_args=(bg.celery_task_id,),
            task_kwargs={},
        )
        assert job.status == QueuedJob.Status.PENDING

        claimed = claim_next_job(lease_seconds=60)
        assert claimed is not None
        assert claimed.id == job.id
        claimed.refresh_from_db()
        assert claimed.status == QueuedJob.Status.RUNNING

    def test_execute_job_success_marks_terminal(self):
        school = self._make_school()
        bg = self._make_background_task(school, task_id='dbq-test-success')

        job = enqueue_background_job(
            background_task=bg,
            school_id=school.id,
            user=None,
            task_func=success_job,
            task_args=(bg.celery_task_id,),
            task_kwargs={},
        )

        claimed = claim_next_job(lease_seconds=60)
        assert claimed and claimed.id == job.id

        ok = execute_job(claimed)
        assert ok is True

        job.refresh_from_db()
        bg.refresh_from_db()
        assert job.status == QueuedJob.Status.SUCCESS
        assert bg.status == BackgroundTask.Status.SUCCESS

    def test_failure_requeues_with_backoff_then_fails(self):
        school = self._make_school()
        bg = self._make_background_task(school, task_id='dbq-test-fail')

        job = enqueue_background_job(
            background_task=bg,
            school_id=school.id,
            user=None,
            task_func=failing_job,
            task_args=(bg.celery_task_id,),
            task_kwargs={},
        )

        job.attempt_count = 0
        job.max_attempts = 2
        job.save(update_fields=['attempt_count', 'max_attempts'])

        # First failure: should requeue with future scheduled_for
        job.status = QueuedJob.Status.RUNNING
        job.attempt_count = 1
        job.save(update_fields=['status', 'attempt_count'])
        before_first_retry = timezone.now()
        complete_job(job, success=False, error_message='first fail')

        job.refresh_from_db()
        assert job.status == QueuedJob.Status.PENDING
        assert job.scheduled_for > before_first_retry

        # Second failure at max attempts: should become FAILED and mark background task failed
        job.status = QueuedJob.Status.RUNNING
        job.attempt_count = job.max_attempts
        job.save(update_fields=['status', 'attempt_count'])
        complete_job(job, success=False, error_message='second fail')

        job.refresh_from_db()
        bg.refresh_from_db()
        assert job.status == QueuedJob.Status.FAILED
        assert bg.status == BackgroundTask.Status.FAILED

    def test_cancel_pending_job(self):
        school = self._make_school()
        bg = self._make_background_task(school, task_id='dbq-test-cancel')

        enqueue_background_job(
            background_task=bg,
            school_id=school.id,
            user=None,
            task_func=success_job,
            task_args=(bg.celery_task_id,),
            task_kwargs={},
        )

        updated = cancel_queued_job(bg.celery_task_id)
        assert updated == 1

        job = QueuedJob.objects.get(background_task=bg)
        assert job.status == QueuedJob.Status.CANCELLED

    def test_requeue_stale_running_jobs(self):
        school = self._make_school()
        bg = self._make_background_task(school, task_id='dbq-test-stale')

        job = enqueue_background_job(
            background_task=bg,
            school_id=school.id,
            user=None,
            task_func=success_job,
            task_args=(bg.celery_task_id,),
            task_kwargs={},
        )
        job.status = QueuedJob.Status.RUNNING
        job.locked_at = timezone.now() - timedelta(minutes=10)
        job.lock_expires_at = timezone.now() - timedelta(minutes=5)
        job.save(update_fields=['status', 'locked_at', 'lock_expires_at'])

        requeued = requeue_stale_running_jobs()
        assert requeued == 1

        job.refresh_from_db()
        assert job.status == QueuedJob.Status.PENDING
        assert job.locked_at is None
        assert job.lock_expires_at is None

    def test_run_job_worker_once_no_jobs(self):
        out = StringIO()
        call_command('run_job_worker', once=True, stdout=out)
        output = out.getvalue()
        assert 'DB job worker started' in output
        assert 'No pending jobs found.' in output
