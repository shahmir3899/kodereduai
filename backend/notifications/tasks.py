"""
Celery tasks for scheduled notifications.
"""

import logging
from datetime import time as dt_time
from datetime import datetime as dt_datetime
from celery import shared_task
from django.utils import timezone
from .observability import REASON_FAILED_DISPATCH, bump_retry_count, mark_log_failed, should_retry_log

logger = logging.getLogger(__name__)


@shared_task
def run_scheduled_absence_in_app_digest(force: bool = False, now_iso: str | None = None):
    """
    All-schools/all-cohorts absence digest scan. Not on Celery Beat any more —
    the live path is event-driven: `attendance.views.AttendanceRecordViewSet
    .bulk_entry` calls `notifications.absence_digest.process_absence_digest_for_cohort`
    directly for the cohort just saved, right when the register is completed.
    This all-schools version is kept as a manual backfill tool (see
    `run_today_notifications` / `run_scheduled_jobs` management commands) for
    registers saved through some other path, or to catch up after downtime.

    For each class cohort, sends consolidated staff digests and parent absent notices
    only after every enrolled student has an attendance row for the target date.
    """
    from django.utils import timezone

    from notifications.absence_digest import process_absence_digest_all_schools

    if now_iso:
        local_now = timezone.localtime(dt_datetime.fromisoformat(now_iso))
    else:
        local_now = timezone.localtime()

    if not force and local_now.hour not in (8, 9, 10):
        return {'skipped': True, 'reason': 'outside_digest_hours', 'hour': local_now.hour}

    summary = process_absence_digest_all_schools(local_now.date())
    logger.info(
        'Scheduled absence in-app digest finished',
        extra={'date': summary.get('date'), 'schools': len(summary.get('schools', []))},
    )
    return summary


def _get_daily_report_send_time(config):
    """Return configured report send time or the historical default (17:00)."""
    if config and config.daily_absence_summary_time:
        return config.daily_absence_summary_time
    return dt_time(hour=17, minute=0)


@shared_task
def send_fee_pending_in_app_notifications():
    """
    All-schools sweep for consolidated fee-pending in-app notifications.
    Not on Celery Beat any more — the live path is event-driven:
    `finance.tasks.generate_monthly_fees_task` calls
    `notifications.triggers.trigger_fee_pending_in_app` directly for its school
    right after fee records are generated. Admins can also re-run it for the
    current school from the Notifications page ("Send Fee Reminders Now").
    This all-schools version stays as a manual `run_scheduled_jobs` backfill.
    """
    from schools.models import School
    from .triggers import trigger_fee_pending_in_app

    now = timezone.localtime()
    if now.day not in (5, 8):
        return {'skipped': True, 'reason': 'outside_fee_pending_days', 'day': now.day}

    schools = School.objects.filter(is_active=True)
    total_sent = 0
    processed_schools = 0
    for school in schools:
        try:
            total_sent += trigger_fee_pending_in_app(school, now.month, now.year)
            processed_schools += 1
        except Exception as e:
            logger.error(f"Fee pending in-app notifications failed for {school.name}: {e}")

    logger.info(
        f"Fee pending in-app notifications complete: {total_sent} sent across {processed_schools} schools"
    )
    return {'total_sent': total_sent, 'processed_schools': processed_schools, 'date': str(now.date())}


@shared_task
def send_daily_absence_summary():
    """
    All-schools sweep for the daily school report (SCHOOL_ADMIN/PRINCIPAL).
    Covers: attendance, lesson plans submitted today, pending fees, staff leave.
    Not on Celery Beat any more — "end of day" has no single triggering event,
    so admins run it on demand from the Notifications page
    ("Generate Daily Report Now", per-school). This all-schools version stays
    as a manual `run_scheduled_jobs` backfill.
    """
    from schools.models import School
    from .models import SchoolNotificationConfig
    from .triggers import trigger_daily_school_report

    local_now = timezone.localtime()
    today = local_now.date()
    schools = School.objects.filter(is_active=True)
    processed_schools = 0
    total_sent = 0

    for school in schools:
        try:
            config = SchoolNotificationConfig.objects.filter(school=school).first()
            if config and not getattr(config, 'daily_report_enabled', True):
                logger.info(
                    "Skipped daily school report",
                    extra={'reason_code': 'skipped_due_to_config', 'school_id': school.id},
                )
                continue

            configured_time = _get_daily_report_send_time(config)
            # Beat fires this task every 10 minutes (settings.CELERY_BEAT_SCHEDULE).
            # Match if the configured time falls inside the current 10-minute bucket
            # for the same hour. trigger_daily_school_report() dedupes via
            # _daily_notification_already_sent so re-runs within the window are safe.
            same_hour = local_now.hour == configured_time.hour
            same_bucket = (local_now.minute // 10) == (configured_time.minute // 10)
            if not (same_hour and same_bucket):
                logger.info(
                    "Skipped daily school report",
                    extra={
                        'reason_code': 'skipped_due_to_schedule',
                        'school_id': school.id,
                        'configured_time': configured_time.strftime('%H:%M'),
                        'current_time': local_now.strftime('%H:%M'),
                    },
                )
                continue

            total_sent += trigger_daily_school_report(school, today)
            processed_schools += 1
        except Exception as e:
            logger.error(f"Daily report failed for {school.name}: {e}")

    logger.info(
        f"Daily school reports processed for {processed_schools} schools at {local_now.strftime('%H:%M')}"
    )
    return {
        'date': str(today),
        'processed_schools': processed_schools,
        'total_sent': total_sent,
    }


@shared_task
def send_class_teacher_attendance_reminders():
    """
    All-schools sweep for class-teacher "please mark attendance" reminders.
    Not on Celery Beat any more — the per-school version of this is now an
    admin-triggered action (see RunNotificationJobView, job='attendance_reminder').
    Kept callable for the manual `run_scheduled_jobs` backfill command.

    Conditions per assignment:
    - Day is not OFF day for that class
    - Teacher is marked PRESENT in staff attendance
    - Student attendance is not yet marked for class/date
    """
    from schools.models import School
    from .triggers import trigger_class_teacher_attendance_pending

    today = timezone.localdate()
    schools = School.objects.filter(is_active=True)
    total_sent = 0

    for school in schools:
        try:
            total_sent += trigger_class_teacher_attendance_pending(school, today)
        except Exception as e:
            logger.error(f"Class-teacher attendance reminder failed for {school.name}: {e}")

    logger.info(f"Class-teacher attendance reminders complete: {total_sent} teachers notified")
    return {'total_sent': total_sent, 'date': str(today)}


@shared_task
def process_notification_queue():
    """
    Process queued/retriable notifications.
    Retries:
    - PENDING notifications older than 1 minute
    - FAILED notifications explicitly marked retriable (limited attempts)
    """
    from .models import NotificationLog
    from .engine import NotificationEngine

    cutoff = timezone.now() - timezone.timedelta(minutes=1)

    candidates = NotificationLog.objects.filter(
        status__in=['PENDING', 'FAILED'],
        created_at__lt=cutoff,
    ).select_related('school')[:100]

    retried = 0
    skipped_non_retriable = 0
    for log in candidates:
        if not should_retry_log(log):
            skipped_non_retriable += 1
            logger.info(
                "Skipped retry for non-retriable notification",
                extra={'reason_code': 'skipped_due_to_non_retriable', 'log_id': log.id},
            )
            continue

        bump_retry_count(log)
        try:
            engine = NotificationEngine(log.school)
            handler = engine._get_channel_handler(log.channel)
            if not handler:
                mark_log_failed(
                    log,
                    reason_code=REASON_FAILED_DISPATCH,
                    error=f'No handler for channel: {log.channel}',
                    retriable=False,
                    extra_metadata={'channel': log.channel},
                )
                continue

            success = handler.send(
                recipient=log.recipient_identifier,
                title=log.title,
                body=log.body,
            )
            if success:
                log.status = 'SENT'
                log.sent_at = timezone.now()
                log.save(update_fields=['status', 'sent_at'])
            else:
                mark_log_failed(
                    log,
                    reason_code=REASON_FAILED_DISPATCH,
                    error='Channel handler returned False',
                    retriable=True,
                    extra_metadata={'channel': log.channel},
                )
            retried += 1
        except Exception as e:
            mark_log_failed(
                log,
                reason_code=REASON_FAILED_DISPATCH,
                error=e,
                retriable=True,
                extra_metadata={'retry_error': str(e), 'channel': log.channel},
            )

    logger.info(
        f"Notification queue processed: {retried} retried, {skipped_non_retriable} skipped"
    )
    return {'retried': retried, 'skipped_non_retriable': skipped_non_retriable}


@shared_task
def dispatch_scheduled_notifications():
    """
    Dispatch notifications that were deferred by smart scheduling.
    Runs every 5 minutes. Picks up SCHEDULED notifications whose
    scheduled_for time has arrived.
    """
    from .models import NotificationLog
    from .engine import NotificationEngine

    now = timezone.now()

    scheduled = NotificationLog.objects.filter(
        status='SCHEDULED',
        scheduled_for__lte=now,
    ).select_related('school')[:100]

    sent = 0
    failed = 0

    for log in scheduled:
        try:
            engine = NotificationEngine(log.school)
            handler = engine._get_channel_handler(log.channel)
            if not handler:
                mark_log_failed(
                    log,
                    reason_code=REASON_FAILED_DISPATCH,
                    error=f'No handler for channel: {log.channel}',
                    retriable=False,
                    extra_metadata={'channel': log.channel},
                )
                failed += 1
                continue

            success = handler.send(
                recipient=log.recipient_identifier,
                title=log.title,
                body=log.body,
                metadata={'log_id': log.id},
            )
            if success:
                log.status = 'SENT'
                log.sent_at = timezone.now()
                log.save(update_fields=['status', 'sent_at'])
            else:
                mark_log_failed(
                    log,
                    reason_code=REASON_FAILED_DISPATCH,
                    error='Channel handler returned False',
                    retriable=True,
                    extra_metadata={'channel': log.channel},
                )

            if success:
                sent += 1
            else:
                failed += 1

        except Exception as e:
            mark_log_failed(
                log,
                reason_code=REASON_FAILED_DISPATCH,
                error=e,
                retriable=True,
                extra_metadata={'channel': log.channel},
            )
            failed += 1
            logger.error(f"Scheduled dispatch failed for log {log.id}: {e}")

    logger.info(f"Scheduled notifications dispatched: {sent} sent, {failed} failed")
    return {'sent': sent, 'failed': failed}
