from django.core.management.base import BaseCommand
from django_celery_beat.models import CrontabSchedule, PeriodicTask


TASK_NAME = "scheduled-absence-in-app-digest"
TASK_PATH = "notifications.tasks.run_scheduled_absence_in_app_digest"


class Command(BaseCommand):
    help = (
        "Ensure notification scheduler DB entries exist for periodic tasks. "
        "Currently syncs the scheduled absence in-app digest task."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show actions without writing changes.",
        )

    def handle(self, *args, **options):
        dry_run = options.get("dry_run", False)

        crontab, _ = CrontabSchedule.objects.get_or_create(
            minute="0",
            hour="8,9,10",
            day_of_week="*",
            day_of_month="*",
            month_of_year="*",
            timezone="Asia/Karachi",
        )

        existing = PeriodicTask.objects.filter(name=TASK_NAME).first()
        action = "unchanged"
        updates = {}

        if existing is None:
            action = "create"
        else:
            if existing.task != TASK_PATH:
                updates["task"] = TASK_PATH
            if existing.crontab_id != crontab.id:
                updates["crontab"] = crontab
            if not existing.enabled:
                updates["enabled"] = True
            if updates:
                action = "update"

        if dry_run:
            self.stdout.write(
                self.style.WARNING(
                    f"[DRY-RUN] {action.upper()} {TASK_NAME} ({TASK_PATH})"
                )
            )
            return

        if action == "create":
            PeriodicTask.objects.create(
                name=TASK_NAME,
                task=TASK_PATH,
                crontab=crontab,
                enabled=True,
            )
        elif action == "update":
            for key, value in updates.items():
                setattr(existing, key, value)
            existing.save(update_fields=list(updates.keys()))

        self.stdout.write(
            self.style.SUCCESS(f"{action.upper()} {TASK_NAME} ({TASK_PATH})")
        )

