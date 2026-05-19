"""
Manual replacement for Celery Beat notification tasks.

Run this command when CELERY_FORCE_SYNC=true (or when Beat is disabled) to
fire the jobs that would normally run on a schedule.

Usage examples
--------------
Run everything for today:
    python manage.py run_scheduled_jobs --all

Run individual jobs:
    python manage.py run_scheduled_jobs --absence-digest
    python manage.py run_scheduled_jobs --fee-reminders
    python manage.py run_scheduled_jobs --notification-queue
    python manage.py run_scheduled_jobs --dispatch-scheduled
    python manage.py run_scheduled_jobs --toc-stale-cleanup

Why this exists
---------------
When CELERY_FORCE_SYNC=true is set the Celery worker and Beat are not started,
so no automatic scheduling occurs.  Admins or a simple cron script can call
this command instead (e.g. via Render Cron Job or OS cron).
"""

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Manually run scheduled notification jobs that normally run via Celery Beat.'

    def add_arguments(self, parser):
        parser.add_argument('--all', action='store_true', help='Run all scheduled notification jobs.')
        parser.add_argument('--absence-digest', action='store_true', help='Run absence in-app digest (daily 08-10h).')
        parser.add_argument('--daily-absence-summary', action='store_true', help='Run daily absence summary email.')
        parser.add_argument('--fee-reminders', action='store_true', help='Run fee reminder notification task.')
        parser.add_argument('--notification-queue', action='store_true', help='Process the notification send queue.')
        parser.add_argument('--dispatch-scheduled', action='store_true', help='Dispatch scheduled notifications.')
        parser.add_argument('--toc-stale-cleanup', action='store_true', help='Mark stale TOC import jobs timed-out.')
        parser.add_argument('--force', action='store_true', help='Skip time-of-day guards inside tasks.')

    def handle(self, *args, **options):
        run_all = options['all']

        if not any([run_all, options['absence_digest'], options['daily_absence_summary'],
                    options['fee_reminders'], options['notification_queue'],
                    options['dispatch_scheduled'], options['toc_stale_cleanup']]):
            self.stderr.write(self.style.ERROR(
                'Specify at least one job flag or use --all.  Run with --help for options.'
            ))
            return

        force = options['force']

        if run_all or options['absence_digest']:
            self._run('run_scheduled_absence_in_app_digest', force=force)

        if run_all or options['daily_absence_summary']:
            self._run('send_daily_absence_summary')

        if run_all or options['fee_reminders']:
            self._run('send_fee_pending_in_app_notifications')

        if run_all or options['notification_queue']:
            self._run('process_notification_queue')

        if run_all or options['dispatch_scheduled']:
            self._run('dispatch_scheduled_notifications')

        if run_all or options['toc_stale_cleanup']:
            self._run_toc_stale()

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------
    def _run(self, task_name, **kwargs):
        from notifications import tasks as notif_tasks
        task_fn = getattr(notif_tasks, task_name, None)
        if task_fn is None:
            self.stderr.write(self.style.WARNING(f'Task {task_name} not found in notifications.tasks — skipped.'))
            return
        self.stdout.write(f'Running {task_name}…')
        try:
            result = task_fn(**kwargs)
            self.stdout.write(self.style.SUCCESS(f'  {task_name} done: {result}'))
        except Exception as exc:
            self.stderr.write(self.style.ERROR(f'  {task_name} FAILED: {exc}'))

    def _run_toc_stale(self):
        from lms.tasks import mark_stale_toc_jobs_timed_out
        self.stdout.write('Running mark_stale_toc_jobs_timed_out…')
        try:
            result = mark_stale_toc_jobs_timed_out(max_age_minutes=15)
            self.stdout.write(self.style.SUCCESS(f'  mark_stale_toc_jobs_timed_out done: {result}'))
        except Exception as exc:
            self.stderr.write(self.style.ERROR(f'  mark_stale_toc_jobs_timed_out FAILED: {exc}'))
