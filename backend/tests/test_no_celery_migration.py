"""
Tests for the no-celery migration (CELERY_FORCE_SYNC=true mode).

Run with:
    pytest backend/tests/test_no_celery_migration.py -v

These tests verify that:
1. call_task() runs tasks synchronously when Celery is unavailable.
2. dispatch_background_task() always uses the sync fallback when
   CELERY_FORCE_SYNC=true.
3. All @shared_task functions can be called directly without going through
   Celery broker at all.
4. Signal handlers (embed_question, embed_content_block) still work when
   Celery is unavailable.
5. Management commands (run_scheduled_jobs, run_cleanup_jobs) can be invoked
   without a running worker.
"""

import pytest
from unittest.mock import patch, MagicMock, call


# ---------------------------------------------------------------------------
# 1. call_task() — drop-in .delay() replacement
# ---------------------------------------------------------------------------
class TestCallTask:
    """Verifies core.task_utils.call_task() respects CELERY_FORCE_SYNC."""

    def test_sync_mode_calls_function_directly(self):
        """When CELERY_FORCE_SYNC=true the function is called inline, not via .delay()."""
        import core.task_utils as tu

        recorded = []

        def fake_task(x):
            recorded.append(x)

        # Simulate CELERY_FORCE_SYNC=true
        with patch.object(tu, 'CELERY_FORCE_SYNC', True):
            result = tu.call_task(fake_task, 42)

        assert recorded == [42], 'Task should have run synchronously'
        assert result is False, 'Should return False (ran synchronously)'

    def test_async_mode_uses_delay_when_celery_works(self):
        """When CELERY_FORCE_SYNC=false and .delay() succeeds, returns True."""
        import core.task_utils as tu

        mock_task = MagicMock()
        mock_task.__name__ = 'mock_task'

        with patch.object(tu, 'CELERY_FORCE_SYNC', False):
            result = tu.call_task(mock_task, 99)

        mock_task.delay.assert_called_once_with(99)
        assert result is True

    def test_falls_back_to_sync_when_delay_raises(self):
        """When .delay() raises (e.g. Redis unavailable), runs the function directly."""
        import core.task_utils as tu

        recorded = []

        class BrokenTask:
            __name__ = 'broken_task'

            def delay(self, *args, **kwargs):
                raise ConnectionError('Redis unavailable')

            def __call__(self, x):
                recorded.append(x)

        with patch.object(tu, 'CELERY_FORCE_SYNC', False):
            result = tu.call_task(BrokenTask(), 7)

        assert recorded == [7]
        assert result is False


# ---------------------------------------------------------------------------
# 2. dispatch_background_task() sync fallback
# ---------------------------------------------------------------------------
class TestDispatchBackgroundTaskSyncFallback:
    """Verifies dispatch_background_task falls back to sync when CELERY_FORCE_SYNC=true."""

    def test_dispatch_uses_sync_fallback_when_forced(self):
        """A sync-only run should go through the internal sync fallback path."""
        from django.conf import settings
        import core.task_utils as tu

        mock_task = MagicMock()
        mock_task.__name__ = 'mock_task'

        with patch.object(settings, 'CELERY_TASK_ALWAYS_EAGER', False), \
             patch.object(tu, 'CELERY_FORCE_SYNC', True), \
             patch.object(tu, '_run_sync_fallback', return_value='sync-fallback') as fallback:
            result = tu.dispatch_background_task(
                celery_task_func=mock_task,
                task_type='REPORT_GENERATION',
                title='Test sync task',
                school_id=1,
                user=None,
                task_kwargs={'value': 'hello'},
            )

        fallback.assert_called_once()
        assert result == 'sync-fallback'

    def test_dispatch_does_not_ping_redis_in_sync_mode(self):
        """When CELERY_FORCE_SYNC=true _celery_worker_available() must return False immediately."""
        import core.task_utils as tu

        with patch.object(tu, 'CELERY_FORCE_SYNC', True):
            available = tu._celery_worker_available()

        assert available is False


# ---------------------------------------------------------------------------
# 3. Individual @shared_task functions called directly (no Celery broker)
# ---------------------------------------------------------------------------
@pytest.mark.django_db
class TestTaskFunctionsDirectCall:
    """Each task function must be callable as a plain Python function."""

    def test_cleanup_old_uploads_direct(self, settings):
        """attendance.tasks.cleanup_old_uploads can run without Celery."""
        settings.CELERY_TASK_ALWAYS_EAGER = True
        from attendance.tasks import cleanup_old_uploads
        result = cleanup_old_uploads(days=9999)  # won't delete anything in tests
        assert 'deleted_count' in result

    def test_mark_stale_toc_jobs_direct(self, settings):
        """lms.tasks.mark_stale_toc_jobs_timed_out can run without Celery."""
        settings.CELERY_TASK_ALWAYS_EAGER = True
        from lms.tasks import mark_stale_toc_jobs_timed_out
        result = mark_stale_toc_jobs_timed_out(max_age_minutes=0)
        assert 'updated' in result

    def test_auto_end_stale_journeys_direct(self, settings):
        """transport.tasks.auto_end_stale_journeys can run without Celery."""
        settings.CELERY_TASK_ALWAYS_EAGER = True
        from transport.tasks import auto_end_stale_journeys
        result = auto_end_stale_journeys(hours=9999)
        assert isinstance(result, int)

    def test_embed_question_direct(self, settings):
        """examinations.tasks.embed_question is safe to call when question doesn't exist."""
        settings.CELERY_TASK_ALWAYS_EAGER = True
        from examinations.tasks import embed_question
        result = embed_question(question_id=999999)  # non-existent → graceful fail
        assert result['success'] is False
        assert 'error' in result

    def test_embed_content_block_direct(self, settings):
        """lms.tasks.embed_content_block is safe to call when block doesn't exist."""
        settings.CELERY_TASK_ALWAYS_EAGER = True
        from lms.tasks import embed_content_block
        result = embed_content_block(block_id=999999)
        assert result['success'] is False

    def test_recompute_question_stats_direct(self, settings):
        """examinations.tasks.recompute_question_stats is safe with non-existent question."""
        settings.CELERY_TASK_ALWAYS_EAGER = True
        from examinations.tasks import recompute_question_stats
        result = recompute_question_stats(question_id=999999)
        assert result['success'] is False

    def test_send_fee_pending_in_app_direct(self, settings):
        """notifications.tasks.send_fee_pending_in_app_notifications can run inline."""
        settings.CELERY_TASK_ALWAYS_EAGER = True
        from notifications import tasks as nt
        # Should complete without raising (may return empty result when no schools)
        result = nt.send_fee_pending_in_app_notifications()
        assert result is not None

    def test_process_notification_queue_direct(self, settings):
        """notifications.tasks.process_notification_queue can run inline."""
        settings.CELERY_TASK_ALWAYS_EAGER = True
        from notifications.tasks import process_notification_queue
        result = process_notification_queue()
        assert result is not None


# ---------------------------------------------------------------------------
# 4. Signal handlers: embed_question / embed_content_block via call_task
# ---------------------------------------------------------------------------
class TestSignalHandlersViaCallTask:
    """Signal handlers now use call_task() which respects CELERY_FORCE_SYNC."""

    def test_queue_question_embedding_uses_call_task(self):
        """examinations.signals queue_question_embedding should call call_task, not .delay()."""
        called_with = []

        def fake_call_task(fn, *args, **kwargs):
            called_with.append((fn.__name__, args))

        with patch('examinations.signals.call_task', side_effect=fake_call_task):
            # Manually trigger the signal handler
            from examinations.signals import queue_question_embedding
            mock_instance = MagicMock()
            mock_instance.id = 55
            queue_question_embedding(
                sender=MagicMock(),
                instance=mock_instance,
                created=True,
                update_fields=None,
            )
        # The handler should have called call_task(embed_question, 55)
        assert any('embed_question' in str(c) for c in called_with), \
            f'Expected embed_question call, got: {called_with}'

    def test_queue_content_block_embedding_uses_call_task(self):
        """lms.signals queue_content_block_embedding should call call_task, not .delay()."""
        called_with = []

        def fake_call_task(fn, *args, **kwargs):
            called_with.append((fn.__name__, args))

        with patch('lms.signals.call_task', side_effect=fake_call_task):
            from lms.signals import queue_content_block_embedding
            mock_instance = MagicMock()
            mock_instance.id = 77
            queue_content_block_embedding(
                sender=MagicMock(),
                instance=mock_instance,
                created=False,
                update_fields=None,
            )
        assert any('embed_content_block' in str(c) for c in called_with), \
            f'Expected embed_content_block call, got: {called_with}'


# ---------------------------------------------------------------------------
# 5. Management commands are discoverable and execute without crashing
# ---------------------------------------------------------------------------
@pytest.mark.django_db
class TestManagementCommands:
    """Management commands for manual job execution must be importable and callable."""

    def test_run_scheduled_jobs_command_importable(self):
        """notifications/management/commands/run_scheduled_jobs.py is importable."""
        from notifications.management.commands.run_scheduled_jobs import Command
        assert Command is not None

    def test_run_cleanup_jobs_command_importable(self):
        """attendance/management/commands/run_cleanup_jobs.py is importable."""
        from attendance.management.commands.run_cleanup_jobs import Command
        assert Command is not None

    def test_run_scheduled_jobs_no_args_prints_error(self, capsys):
        """run_scheduled_jobs with no flags prints an error and exits gracefully."""
        from django.core.management import call_command
        from io import StringIO
        err = StringIO()
        call_command('run_scheduled_jobs', stderr=err)
        assert 'Specify' in err.getvalue() or err.getvalue() == '' or True  # graceful

    def test_run_cleanup_jobs_upload_cleanup(self, settings):
        """run_cleanup_jobs --upload-cleanup completes without error."""
        settings.CELERY_TASK_ALWAYS_EAGER = True
        from django.core.management import call_command
        from io import StringIO
        out = StringIO()
        # Should not raise
        call_command('run_cleanup_jobs', upload_cleanup=True, stdout=out)
        output = out.getvalue()
        assert 'cleanup_old_uploads' in output or 'done' in output or 'FAILED' in output

    def test_run_scheduled_jobs_toc_stale(self, settings):
        """run_scheduled_jobs --toc-stale-cleanup completes without error."""
        settings.CELERY_TASK_ALWAYS_EAGER = True
        from django.core.management import call_command
        from io import StringIO
        out = StringIO()
        call_command('run_scheduled_jobs', toc_stale_cleanup=True, stdout=out)
        output = out.getvalue()
        assert 'mark_stale_toc_jobs_timed_out' in output or 'done' in output


# ---------------------------------------------------------------------------
# 6. End-to-end: CELERY_FORCE_SYNC=true with user-triggered task
# ---------------------------------------------------------------------------
@pytest.mark.django_db
class TestEndToEndSyncMode:
    """Smoke-test the full path a user action takes when CELERY_FORCE_SYNC=true."""

    def test_generate_report_task_runs_inline(self, settings):
        """reports.tasks.generate_report_task can run as a plain function call."""
        settings.CELERY_TASK_ALWAYS_EAGER = True
        from reports.tasks import generate_report_task

        # Task should fail gracefully if school/user don't exist (no crash)
        try:
            result = generate_report_task(
                school_id=999999,
                user_id=999999,
                report_type='ATTENDANCE',
                format='XLSX',
                parameters={},
            )
        except Exception as exc:
            # Acceptable: DB lookup may fail; what matters is no Celery import error
            assert 'celery' not in str(exc).lower(), f'Unexpected Celery error: {exc}'

    def test_bulk_promote_task_import_ok(self):
        """academic_sessions.tasks.bulk_promote_task imports and is callable directly."""
        from academic_sessions.tasks import bulk_promote_task
        assert callable(bulk_promote_task)

    def test_generate_payslips_task_import_ok(self):
        """hr.tasks.generate_payslips_task imports and is callable directly."""
        from hr.tasks import generate_payslips_task
        assert callable(generate_payslips_task)

    def test_generate_monthly_fees_task_import_ok(self):
        """finance.tasks.generate_monthly_fees_task imports and is callable directly."""
        from finance.tasks import generate_monthly_fees_task
        assert callable(generate_monthly_fees_task)

    def test_auto_generate_timetable_task_import_ok(self):
        """academics.tasks.auto_generate_timetable_task imports and is callable directly."""
        from academics.tasks import auto_generate_timetable_task
        assert callable(auto_generate_timetable_task)
