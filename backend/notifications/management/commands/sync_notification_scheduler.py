"""
Sync periodic-task rows in django_celery_beat (DatabaseScheduler) with the
CELERY_BEAT_SCHEDULE dict in settings.py.

DatabaseScheduler seeds *new* PeriodicTask rows from CELERY_BEAT_SCHEDULE on
Beat startup, but it does NOT update existing rows when the cron in settings
changes. So whenever you tweak a schedule in code, you must also run this
command on production to update the DB.

Usage (Render Shell):
    python manage.py sync_notification_scheduler
    python manage.py sync_notification_scheduler --dry-run

What it syncs:
    * 'daily-absence-summary'              (notifications.tasks.send_daily_absence_summary)
    * 'scheduled-absence-in-app-digest'    (notifications.tasks.run_scheduled_absence_in_app_digest)
    * 'process-notification-queue'         (notifications.tasks.process_notification_queue)
    * 'dispatch-scheduled-notifications'   (notifications.tasks.dispatch_scheduled_notifications)
    * 'mark-stale-toc-jobs-timed-out'      (lms.tasks.mark_stale_toc_jobs_timed_out)
    * 'retry-failed-uploads'               (attendance.tasks.retry_failed_uploads)

Tasks not in this list are left untouched (Beat will auto-seed them if missing).
"""

from __future__ import annotations

from django.conf import settings
from django.core.management.base import BaseCommand
from django_celery_beat.models import CrontabSchedule, PeriodicTask


# Tasks whose cron we actively manage from settings.CELERY_BEAT_SCHEDULE.
# Add a name here when you change its schedule in settings.py and need the
# change to propagate to production Beat without a manual DB edit.
MANAGED_SCHEDULES = (
    'daily-absence-summary',
    'scheduled-absence-in-app-digest',
    'process-notification-queue',
    'dispatch-scheduled-notifications',
    'mark-stale-toc-jobs-timed-out',
    'retry-failed-uploads',
<<<<<<< HEAD
)

# Tasks removed from the codebase — disable their Beat DB rows on next deploy.
TASKS_TO_DISABLE = (
    'nightly-sibling-detection',
=======
>>>>>>> 36421588127fc1deebcf1d5520419c3810cba43a
)


def _crontab_kwargs_from_celery(schedule) -> dict:
    """Translate a celery.schedules.crontab → django_celery_beat CrontabSchedule kwargs."""
    return {
        'minute': str(schedule._orig_minute),
        'hour': str(schedule._orig_hour),
        'day_of_week': str(schedule._orig_day_of_week),
        'day_of_month': str(schedule._orig_day_of_month),
        'month_of_year': str(schedule._orig_month_of_year),
        'timezone': str(getattr(schedule, 'tz', None) or settings.CELERY_TIMEZONE),
    }


class Command(BaseCommand):
    help = (
        "Ensure django_celery_beat PeriodicTask rows match the schedules in "
        "settings.CELERY_BEAT_SCHEDULE for managed task names."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show actions without writing changes.",
        )

    def handle(self, *args, **options):
        from celery.schedules import crontab as CeleryCrontab

        dry_run = options.get("dry_run", False)
        beat_schedule = getattr(settings, 'CELERY_BEAT_SCHEDULE', {})

        for name in MANAGED_SCHEDULES:
            entry = beat_schedule.get(name)
            if entry is None:
                self.stdout.write(
                    self.style.WARNING(
                        f"SKIP {name}: not present in settings.CELERY_BEAT_SCHEDULE"
                    )
                )
                continue

            sched = entry.get('schedule')
            if not isinstance(sched, CeleryCrontab):
                self.stdout.write(
                    self.style.WARNING(
                        f"SKIP {name}: schedule is not a crontab() (got {type(sched).__name__})"
                    )
                )
                continue

            task_path = entry['task']
            cron_kwargs = _crontab_kwargs_from_celery(sched)

            crontab_row, _ = CrontabSchedule.objects.get_or_create(**cron_kwargs)

            existing = PeriodicTask.objects.filter(name=name).first()
            action = "unchanged"
            updates: dict = {}

            if existing is None:
                action = "create"
            else:
                if existing.task != task_path:
                    updates["task"] = task_path
                if existing.crontab_id != crontab_row.id:
                    updates["crontab"] = crontab_row
                    updates["interval"] = None  # ensure we use crontab, not interval
                if not existing.enabled:
                    updates["enabled"] = True
                if updates:
                    action = "update"

            label = (
                f"{name} -> {task_path} "
                f"@ {cron_kwargs['minute']} {cron_kwargs['hour']} "
                f"{cron_kwargs['day_of_month']} {cron_kwargs['month_of_year']} "
                f"{cron_kwargs['day_of_week']}"
            )

            if dry_run:
                self.stdout.write(
                    self.style.WARNING(f"[DRY-RUN] {action.upper()} {label}")
                )
                continue

            if action == "create":
                PeriodicTask.objects.create(
                    name=name,
                    task=task_path,
                    crontab=crontab_row,
                    enabled=True,
                )
            elif action == "update":
                for key, value in updates.items():
                    setattr(existing, key, value)
                existing.save(update_fields=list(updates.keys()))

            self.stdout.write(self.style.SUCCESS(f"{action.upper()} {label}"))

        # Disable removed tasks so Beat stops trying to execute them.
        for name in TASKS_TO_DISABLE:
            try:
                task = PeriodicTask.objects.get(name=name)
            except PeriodicTask.DoesNotExist:
                self.stdout.write(f"SKIP DISABLE {name}: not in DB")
                continue
            if not task.enabled:
                self.stdout.write(f"ALREADY DISABLED {name}")
                continue
            if not dry_run:
                task.enabled = False
                task.save(update_fields=['enabled'])
            self.stdout.write(self.style.SUCCESS(f"DISABLED {name}"))
