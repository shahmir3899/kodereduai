"""
Celery tasks for scheduled notifications.
"""

import logging
from datetime import time as dt_time
from celery import shared_task
from django.utils import timezone
from .observability import REASON_FAILED_DISPATCH, bump_retry_count, mark_log_failed, should_retry_log

logger = logging.getLogger(__name__)


def _get_daily_report_send_time(config):
    """Return configured report send time or the historical default (17:00)."""
    if config and config.daily_absence_summary_time:
        return config.daily_absence_summary_time
    return dt_time(hour=17, minute=0)


@shared_task
def send_fee_reminders():
    """
    Monthly fee reminder task.
    Sends reminders to parents with unpaid fees for the current month.
    Scheduler can invoke this task daily; per-school config decides due day.
    """
    from schools.models import School
    from .models import SchoolNotificationConfig
    from .triggers import trigger_fee_reminder

    now = timezone.now()
    month = now.month
    year = now.year

    schools = School.objects.filter(is_active=True)
    total_sent = 0
    processed_schools = 0

    for school in schools:
        try:
            config = SchoolNotificationConfig.objects.filter(school=school).first()
            reminder_day = config.fee_reminder_day if config else 5

            if now.day != reminder_day:
                logger.info(
                    "Skipped fee reminders",
                    extra={
                        'reason_code': 'skipped_due_to_schedule',
                        'school_id': school.id,
                        'scheduled_day': reminder_day,
                        'current_day': now.day,
                    },
                )
                continue

            if config and not config.whatsapp_enabled:
                continue

            sent = trigger_fee_reminder(school, month, year)
            total_sent += sent
            processed_schools += 1
        except Exception as e:
            logger.error(f"Fee reminder failed for {school.name}: {e}")

    logger.info(
        f"Fee reminders complete: {total_sent} sent across {processed_schools} due schools"
    )
    return {'total_sent': total_sent, 'processed_schools': processed_schools}


@shared_task
def send_fee_overdue_alerts():
    """
    Weekly check for overdue fees.
    Sends alerts for fees that are still pending from the previous month.
    """
    from schools.models import School
    from .triggers import trigger_fee_overdue

    now = timezone.now()
    # Check previous month
    if now.month == 1:
        prev_month, prev_year = 12, now.year - 1
    else:
        prev_month, prev_year = now.month - 1, now.year

    schools = School.objects.filter(is_active=True)
    total_sent = 0

    for school in schools:
        try:
            sent = trigger_fee_overdue(school, prev_month, prev_year)
            total_sent += sent
        except Exception as e:
            logger.error(f"Fee overdue alert failed for {school.name}: {e}")

    logger.info(f"Fee overdue alerts complete: {total_sent} sent")
    return {'total_sent': total_sent}


@shared_task
def send_daily_absence_summary():
    """
    Daily comprehensive school report sent to SCHOOL_ADMIN and PRINCIPAL users.
    Covers: attendance, lesson plans submitted today, pending fees, staff leave.
    Scheduler can invoke this task frequently; per-school configured
    daily_absence_summary_time determines when each school is due.
    Replaces the old absence-only summary; uses trigger_daily_school_report().
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
            if (local_now.hour, local_now.minute) != (
                configured_time.hour,
                configured_time.minute,
            ):
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
def send_class_teacher_fee_reminders():
    """
    Send consolidated fee-pending notifications to class teachers.
    Each teacher gets a single in-app message listing unpaid students in
    their class for the current month.
    Runs on the 10th and 15th of each month (see CELERY_BEAT_SCHEDULE).
    """
    from schools.models import School
    from .triggers import trigger_class_teacher_fee_pending

    now = timezone.now()
    month = now.month
    year = now.year

    schools = School.objects.filter(is_active=True)
    total_sent = 0

    for school in schools:
        try:
            sent = trigger_class_teacher_fee_pending(school, month, year)
            total_sent += sent
        except Exception as e:
            logger.error(f"Class-teacher fee reminder failed for {school.name}: {e}")

    logger.info(f"Class-teacher fee reminders complete: {total_sent} teachers notified")
    return {'total_sent': total_sent}


@shared_task
def send_class_teacher_attendance_reminders():
    """
    Send class-teacher reminders at 11:00 when attendance is still unmarked.

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
