"""
Manual replacement for Celery Beat maintenance / cleanup tasks.

Run this command when CELERY_FORCE_SYNC=true (or when Beat is disabled) to
execute jobs that used to run on an automatic schedule.

Usage examples
--------------
    python manage.py run_cleanup_jobs --all
    python manage.py run_cleanup_jobs --upload-cleanup
    python manage.py run_cleanup_jobs --transport
    python manage.py run_cleanup_jobs --thresholds

Why this exists
---------------
With CELERY_FORCE_SYNC=true the Beat scheduler is not started, so maintenance
jobs never fire automatically.  Run this via a simple cron job (e.g. a Render
Cron Job calling ``python manage.py run_cleanup_jobs --all`` once a day).
"""

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Manually run maintenance / cleanup jobs that normally run via Celery Beat.'

    def add_arguments(self, parser):
        parser.add_argument('--all', action='store_true', help='Run all cleanup jobs.')
        parser.add_argument('--upload-cleanup', action='store_true', help='Delete old failed attendance uploads (90d).')
        parser.add_argument('--transport', action='store_true', help='Cleanup old GPS data and auto-end stale journeys.')
        parser.add_argument('--thresholds', action='store_true', help='Auto-tune OCR accuracy thresholds (weekly).')
        parser.add_argument('--toc-stale', action='store_true', help='Mark stale TOC import jobs timed-out.')
        parser.add_argument('--face-attendance', action='store_true', help='Cleanup old failed face sessions (90d) and expired live-detection events.')

    def handle(self, *args, **options):
        run_all = options['all']

        if not any([run_all, options['upload_cleanup'], options['transport'],
                    options['thresholds'], options['toc_stale'], options['face_attendance']]):
            self.stderr.write(self.style.ERROR(
                'Specify at least one job flag or use --all.  Run with --help for options.'
            ))
            return

        if run_all or options['upload_cleanup']:
            self._cleanup_uploads()

        if run_all or options['transport']:
            self._cleanup_transport()

        if run_all or options['thresholds']:
            self._auto_tune_thresholds()

        if run_all or options['toc_stale']:
            self._toc_stale_cleanup()

        if run_all or options['face_attendance']:
            self._cleanup_face_attendance()

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------
    def _cleanup_uploads(self):
        from attendance.tasks import cleanup_old_uploads
        self.stdout.write('Running cleanup_old_uploads (90 days)…')
        try:
            result = cleanup_old_uploads(days=90)
            self.stdout.write(self.style.SUCCESS(f'  done: {result}'))
        except Exception as exc:
            self.stderr.write(self.style.ERROR(f'  FAILED: {exc}'))

    def _cleanup_transport(self):
        from transport.tasks import cleanup_old_location_data, auto_end_stale_journeys
        for fn, kwargs, label in [
            (auto_end_stale_journeys, {'hours': 2}, 'auto_end_stale_journeys'),
            (cleanup_old_location_data, {'days': 7}, 'cleanup_old_location_data'),
        ]:
            self.stdout.write(f'Running {label}…')
            try:
                result = fn(**kwargs)
                self.stdout.write(self.style.SUCCESS(f'  done: {result}'))
            except Exception as exc:
                self.stderr.write(self.style.ERROR(f'  FAILED: {exc}'))

    def _auto_tune_thresholds(self):
        from attendance.tasks import auto_tune_thresholds
        self.stdout.write('Running auto_tune_thresholds…')
        try:
            result = auto_tune_thresholds()
            self.stdout.write(self.style.SUCCESS(f'  done: {result}'))
        except Exception as exc:
            self.stderr.write(self.style.ERROR(f'  FAILED: {exc}'))

    def _toc_stale_cleanup(self):
        from lms.tasks import mark_stale_toc_jobs_timed_out
        self.stdout.write('Running mark_stale_toc_jobs_timed_out…')
        try:
            result = mark_stale_toc_jobs_timed_out(max_age_minutes=60)
            self.stdout.write(self.style.SUCCESS(f'  done: {result}'))
        except Exception as exc:
            self.stderr.write(self.style.ERROR(f'  FAILED: {exc}'))

    def _cleanup_face_attendance(self):
        from face_attendance.tasks import cleanup_old_face_sessions, cleanup_old_live_detection_events
        for fn, kwargs, label in [
            (cleanup_old_face_sessions, {}, 'cleanup_old_face_sessions'),
            (cleanup_old_live_detection_events, {}, 'cleanup_old_live_detection_events'),
        ]:
            self.stdout.write(f'Running {label}…')
            try:
                result = fn(**kwargs)
                self.stdout.write(self.style.SUCCESS(f'  done: {result}'))
            except Exception as exc:
                self.stderr.write(self.style.ERROR(f'  FAILED: {exc}'))
