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
    Daily summary of absent students sent to school admins.
    Runs at the configured time (default: 5 PM).
    """
    from schools.models import School
    from attendance.models import AttendanceRecord
    from users.models import User
    from .engine import NotificationEngine

    today = timezone.now().date()
    schools = School.objects.filter(is_active=True)

    for school in schools:
        try:
            absent_count = AttendanceRecord.objects.filter(
                school=school,
                date=today,
                status='ABSENT',
            ).count()

            present_count = AttendanceRecord.objects.filter(
                school=school,
                date=today,
                status='PRESENT',
            ).count()

            total = absent_count + present_count
            if total == 0:
                continue

            engine = NotificationEngine(school)
            admins = User.objects.filter(
                school=school,
                role__in=['SCHOOL_ADMIN', 'PRINCIPAL'],
            )

            title = f"Daily Attendance Summary - {today.strftime('%d %B %Y')}"
            body = (
                f"Attendance Summary for {school.name}:\n"
                f"Present: {present_count}\n"
                f"Absent: {absent_count}\n"
                f"Total: {total}\n"
                f"Attendance Rate: {round(present_count / total * 100, 1)}%"
            )

            for admin_user in admins:
                engine.send(
                    event_type='GENERAL',
                    channel='IN_APP',
                    context={},
                    recipient_identifier=str(admin_user.id),
                    recipient_type='ADMIN',
                    recipient_user=admin_user,
                    title=title,
                    body=body,
                )

        except Exception as e:
            logger.error(f"Daily summary failed for {school.name}: {e}")

    logger.info("Daily absence summaries sent")
    return {'date': str(today)}


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
