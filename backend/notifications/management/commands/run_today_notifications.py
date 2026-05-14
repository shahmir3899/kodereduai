"""
Manually fire today's scheduled notification tasks for one or more schools.

Use this when Celery Beat / worker did not run for a day (e.g. infra outage)
and you need to deliver the same notifications users would have seen.

Examples (Windows PowerShell):

  # Show what would be run (no DB writes):
  python manage.py run_today_notifications --schools 1 2 --dry-run

  # Actually run today's:
  #   * absence digest (08-10 AM cohort task)
  #   * daily school report (5 PM admin/principal task)
  python manage.py run_today_notifications --schools 1 2 --tasks digest daily-report

  # All supported tasks for all active schools:
  python manage.py run_today_notifications --tasks digest daily-report teacher-reminder

Supported --tasks values:
  digest            run_scheduled_absence_in_app_digest (08-10 AM cohort)
  daily-report      send_daily_absence_summary (5 PM admin/principal)
  teacher-reminder  send_class_teacher_attendance_reminders (11 AM)

Safety / idempotency:
  * Each task uses its own dedupe markers, so re-running the same task on the
    same day is safe and will skip already-sent items:
      - digest: AttendanceAbsenceInAppDigestMarker per (school, date, cohort)
      - daily-report: _daily_notification_already_sent(...) per (school, user, title, date)
      - teacher-reminder: NotificationLog dedupe on title for the day
  * No outer transaction wraps the run — each NotificationLog commits on its
    own, so a single statement timeout (Supabase pooler) doesn't roll back the
    work already done.
"""

from __future__ import annotations

from datetime import date as _date

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone


SUPPORTED_TASKS = {'digest', 'daily-report', 'teacher-reminder'}


class Command(BaseCommand):
    help = 'Manually run today\'s notification tasks (digest, daily-report, teacher-reminder).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--schools',
            nargs='+',
            type=int,
            help='School IDs to run for. Default: all active schools.',
        )
        parser.add_argument(
            '--tasks',
            nargs='+',
            default=['digest', 'daily-report'],
            help=f'Tasks to run. One or more of: {", ".join(sorted(SUPPORTED_TASKS))}',
        )
        parser.add_argument(
            '--date',
            help='Target date YYYY-MM-DD (default: today, Asia/Karachi).',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Print what would be invoked without calling the trigger code.',
        )

    def handle(self, *args, **opts):
        from schools.models import School
        from notifications.absence_digest import process_absence_digest_for_school
        from notifications.recipients import get_admin_users
        from notifications.triggers import (
            trigger_class_teacher_attendance_pending,
            trigger_daily_school_report,
        )

        tasks = set(opts['tasks'])
        unknown = tasks - SUPPORTED_TASKS
        if unknown:
            raise CommandError(
                f'Unknown task(s): {", ".join(sorted(unknown))}. '
                f'Supported: {", ".join(sorted(SUPPORTED_TASKS))}'
            )

        if opts.get('date'):
            try:
                target_date = _date.fromisoformat(opts['date'])
            except ValueError as exc:
                raise CommandError(f'Invalid --date: {exc}')
        else:
            target_date = timezone.localdate()

        school_qs = School.objects.filter(is_active=True)
        if opts.get('schools'):
            school_qs = school_qs.filter(id__in=opts['schools'])
        schools = list(school_qs.order_by('id'))
        if not schools:
            raise CommandError('No matching active schools.')

        self.stdout.write(
            self.style.NOTICE(
                f'Target date: {target_date}  (server tz: {timezone.get_current_timezone_name()})'
            )
        )
        self.stdout.write(
            self.style.NOTICE(f'Schools: {", ".join(f"{s.id}:{s.name}" for s in schools)}')
        )
        self.stdout.write(self.style.NOTICE(f'Tasks: {sorted(tasks)}'))

        if opts['dry_run']:
            self.stdout.write(self.style.WARNING('DRY-RUN: no triggers will be invoked.'))
            self._dry_run_report(schools, tasks)
            return

        totals = {'digest_cohorts_completed': 0, 'daily_report_sent': 0, 'teacher_reminder_sent': 0}
        for school in schools:
            self.stdout.write('')
            self.stdout.write(self.style.MIGRATE_HEADING(f'--- {school.id}: {school.name} ---'))

            if 'digest' in tasks:
                try:
                    stats = process_absence_digest_for_school(school, target_date)
                    totals['digest_cohorts_completed'] += stats.get('cohorts_staff_digest', 0)
                    self.stdout.write(f'  digest: {stats}')
                except Exception as exc:
                    self.stdout.write(self.style.ERROR(f'  digest FAILED: {exc!r}'))

            if 'daily-report' in tasks:
                try:
                    sent = trigger_daily_school_report(school, target_date)
                    totals['daily_report_sent'] += sent
                    self.stdout.write(f'  daily-report: sent={sent} admin/principal users')
                except Exception as exc:
                    self.stdout.write(self.style.ERROR(f'  daily-report FAILED: {exc!r}'))

            if 'teacher-reminder' in tasks:
                try:
                    sent = trigger_class_teacher_attendance_pending(school, target_date)
                    totals['teacher_reminder_sent'] += sent
                    self.stdout.write(f'  teacher-reminder: sent={sent} teachers')
                except Exception as exc:
                    self.stdout.write(self.style.ERROR(f'  teacher-reminder FAILED: {exc!r}'))

        self.stdout.write('')
        self.stdout.write(self.style.SUCCESS(f'Done. totals={totals}'))

    def _dry_run_report(self, schools, tasks):
        from academic_sessions.models import AcademicYear, StudentEnrollment
        from notifications.recipients import get_admin_users

        for school in schools:
            self.stdout.write('')
            self.stdout.write(self.style.MIGRATE_HEADING(f'--- {school.id}: {school.name} ---'))

            if 'daily-report' in tasks:
                admins = get_admin_users(school)
                self.stdout.write(
                    f'  daily-report would target {len(admins)} admin/principal user(s): '
                    f'{[u.username for u in admins]}'
                )

            if 'digest' in tasks or 'teacher-reminder' in tasks:
                ay = AcademicYear.objects.filter(
                    school=school, is_current=True, is_active=True
                ).first()
                if not ay:
                    self.stdout.write('  digest/teacher-reminder: no current academic year — would skip')
                else:
                    cohorts = (
                        StudentEnrollment.objects.filter(
                            school=school,
                            academic_year=ay,
                            is_active=True,
                            status=StudentEnrollment.Status.ACTIVE,
                            student__is_active=True,
                        )
                        .values_list('class_obj_id', 'session_class_id')
                        .distinct()
                        .count()
                    )
                    self.stdout.write(f'  digest: would scan {cohorts} cohort(s) for academic year {ay.name}')
                    self.stdout.write(
                        f'  teacher-reminder: would consider all class-teacher assignments '
                        f'in current/year-null years for {school.name}'
                    )
