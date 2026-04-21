"""
Celery tasks for scheduled notifications.
"""

import logging
from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task
def send_fee_reminders():
    """
    Monthly fee reminder task.
    Sends reminders to parents with unpaid fees for the current month.
    Runs on the configured fee_reminder_day (default: 5th of month).
    """
    from schools.models import School
    from .models import SchoolNotificationConfig
    from .triggers import trigger_fee_reminder

    now = timezone.now()
    month = now.month
    year = now.year

    schools = School.objects.filter(is_active=True)
    total_sent = 0

    for school in schools:
        try:
            config = SchoolNotificationConfig.objects.filter(school=school).first()
            if config and not config.whatsapp_enabled:
                continue

            sent = trigger_fee_reminder(school, month, year)
            total_sent += sent
        except Exception as e:
            logger.error(f"Fee reminder failed for {school.name}: {e}")

    logger.info(f"Fee reminders complete: {total_sent} sent across all schools")
    return {'total_sent': total_sent}


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
    Runs at 5 PM daily (see CELERY_BEAT_SCHEDULE).
    Replaces the old absence-only summary; uses trigger_daily_school_report().
    """
    from schools.models import School
    from .triggers import trigger_daily_school_report

    today = timezone.now().date()
    schools = School.objects.filter(is_active=True)

    for school in schools:
        try:
            trigger_daily_school_report(school, today)
        except Exception as e:
            logger.error(f"Daily report failed for {school.name}: {e}")

    logger.info("Daily school reports sent")
    return {'date': str(today)}


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
    Process pending notifications that failed to send immediately.
    Retries PENDING notifications that are older than 1 minute.
    """
    from .models import NotificationLog
    from .engine import NotificationEngine

    cutoff = timezone.now() - timezone.timedelta(minutes=1)

    pending = NotificationLog.objects.filter(
        status='PENDING',
        created_at__lt=cutoff,
    ).select_related('school')[:100]

    retried = 0
    for log in pending:
        try:
            engine = NotificationEngine(log.school)
            handler = engine._get_channel_handler(log.channel)
            if handler:
                success = handler.send(
                    recipient=log.recipient_identifier,
                    title=log.title,
                    body=log.body,
                )
                if success:
                    log.status = 'SENT'
                    log.sent_at = timezone.now()
                else:
                    log.status = 'FAILED'
                log.save(update_fields=['status', 'sent_at'])
                retried += 1
        except Exception as e:
            log.status = 'FAILED'
            log.metadata = {'retry_error': str(e)}
            log.save(update_fields=['status', 'metadata'])

    logger.info(f"Notification queue processed: {retried} retried")
    return {'retried': retried}


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
                log.status = 'FAILED'
                log.metadata = {'error': f'No handler for channel: {log.channel}'}
                log.save(update_fields=['status', 'metadata'])
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
            else:
                log.status = 'FAILED'
                log.metadata = {'error': 'Channel handler returned False'}

            log.save(update_fields=['status', 'sent_at', 'metadata'])

            if success:
                sent += 1
            else:
                failed += 1

        except Exception as e:
            log.status = 'FAILED'
            log.metadata = {'error': str(e)}
            log.save(update_fields=['status', 'metadata'])
            failed += 1
            logger.error(f"Scheduled dispatch failed for log {log.id}: {e}")

    logger.info(f"Scheduled notifications dispatched: {sent} sent, {failed} failed")
    return {'sent': sent, 'failed': failed}
