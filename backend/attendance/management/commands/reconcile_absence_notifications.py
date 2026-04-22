"""
Reconcile daily absentees vs in-app ABSENCE notification logs.

Usage example:
  python manage.py reconcile_absence_notifications --school_id 37 --date 2026-04-22
  python manage.py reconcile_absence_notifications --school_id 37 --date 2026-04-22 --recipient_user_id 12 --output report.csv
"""

import csv
from collections import defaultdict

from django.core.management.base import BaseCommand, CommandError
from django.utils.dateparse import parse_date

from attendance.models import AttendanceRecord
from notifications.models import NotificationLog


class Command(BaseCommand):
    help = "Reconcile ABSENT attendance records against IN_APP ABSENCE NotificationLog rows."

    def add_arguments(self, parser):
        parser.add_argument("--school_id", type=int, required=True)
        parser.add_argument("--date", type=str, required=True, help="YYYY-MM-DD")
        parser.add_argument("--recipient_user_id", type=int, required=False)
        parser.add_argument("--output", type=str, required=False, help="Optional CSV output path")

    def handle(self, *args, **options):
        school_id = options["school_id"]
        target_date = parse_date(options["date"])
        recipient_user_id = options.get("recipient_user_id")
        output = options.get("output")

        if not target_date:
            raise CommandError("Invalid --date format. Use YYYY-MM-DD")

        absent_records = list(
            AttendanceRecord.objects.filter(
                school_id=school_id,
                date=target_date,
                status=AttendanceRecord.AttendanceStatus.ABSENT,
            )
            .select_related("student")
            .order_by("student__name")
        )

        logs_qs = NotificationLog.objects.filter(
            school_id=school_id,
            event_type="ABSENCE",
            channel="IN_APP",
            created_at__date=target_date,
            student_id__in=[r.student_id for r in absent_records],
        ).select_related("recipient_user", "student")

        all_logs = list(logs_qs)
        if recipient_user_id:
            scoped_logs = [l for l in all_logs if l.recipient_user_id == recipient_user_id]
        else:
            scoped_logs = all_logs

        logs_by_student_all = defaultdict(list)
        for log in all_logs:
            logs_by_student_all[log.student_id].append(log)

        logs_by_student_scoped = defaultdict(list)
        for log in scoped_logs:
            logs_by_student_scoped[log.student_id].append(log)

        rows = []
        for record in absent_records:
            student_logs_scoped = logs_by_student_scoped.get(record.student_id, [])
            student_logs_all = logs_by_student_all.get(record.student_id, [])

            if student_logs_scoped:
                if len(student_logs_scoped) > 1:
                    root_cause = "MULTIPLE_LOGS"
                elif any(log.status == "FAILED" for log in student_logs_scoped):
                    root_cause = "FAILED_DISPATCH"
                else:
                    root_cause = "MATCHED"
            else:
                if recipient_user_id and student_logs_all:
                    root_cause = "RECIPIENT_MISMATCH"
                else:
                    root_cause = "MISSING_NOTIFICATION_LOG"

            recipient_ids = sorted({str(log.recipient_user_id) for log in student_logs_scoped if log.recipient_user_id})
            first_log_time = min((log.created_at for log in student_logs_scoped), default=None)

            rows.append(
                {
                    "student_id": record.student_id,
                    "student_name": record.student.name,
                    "attendance_status": record.status,
                    "has_notification_log": bool(student_logs_scoped),
                    "notification_count": len(student_logs_scoped),
                    "recipient_user_ids": ",".join(recipient_ids),
                    "first_log_time": first_log_time.isoformat() if first_log_time else "",
                    "root_cause_bucket": root_cause,
                }
            )

        matched = sum(1 for row in rows if row["root_cause_bucket"] in {"MATCHED", "MULTIPLE_LOGS", "FAILED_DISPATCH"})
        missing = len(rows) - matched

        self.stdout.write(self.style.SUCCESS("Absence Notification Reconciliation"))
        self.stdout.write(f"School: {school_id} | Date: {target_date}")
        if recipient_user_id:
            self.stdout.write(f"Recipient filter: {recipient_user_id}")
        self.stdout.write(f"Absentees: {len(rows)} | Matched: {matched} | Missing: {missing}")
        self.stdout.write("-")

        for row in rows:
            self.stdout.write(
                f"{row['student_id']:>5} | {row['student_name'][:35]:<35} | "
                f"notif={row['notification_count']} | {row['root_cause_bucket']}"
            )

        if output:
            fieldnames = [
                "student_id",
                "student_name",
                "attendance_status",
                "has_notification_log",
                "notification_count",
                "recipient_user_ids",
                "first_log_time",
                "root_cause_bucket",
            ]
            with open(output, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(rows)
            self.stdout.write(self.style.SUCCESS(f"CSV written: {output}"))
