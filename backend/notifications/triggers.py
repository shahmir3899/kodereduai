"""
Notification trigger functions.
Called by other modules to fire notifications through the engine.
"""

import logging
from django.utils import timezone

logger = logging.getLogger(__name__)


def _get_config(school):
    """Get school notification config, returns None if not configured."""
    from .models import SchoolNotificationConfig
    try:
        return SchoolNotificationConfig.objects.get(school=school)
    except SchoolNotificationConfig.DoesNotExist:
        return None


def trigger_absence_notification(attendance_record):
    """
    Send absence notification to parent after attendance confirmation.

    Args:
        attendance_record: AttendanceRecord instance (status=ABSENT)
    """
    from .engine import NotificationEngine

    student = attendance_record.student
    school = attendance_record.school

    config = _get_config(school)
    if config and not config.absence_notification_enabled:
        logger.info(f"Absence notifications disabled for {school.name}, skipping")
        return None

    if not student.parent_phone:
        logger.info(f"No parent phone for {student.name}, skipping notification")
        return None

    engine = NotificationEngine(school)

    context = {
        'student_name': student.name,
        'class_name': student.class_obj.name,
        'date': attendance_record.date.strftime('%d %B %Y') if attendance_record.date else '',
        'school_name': school.name,
        'roll_number': student.roll_number,
    }

    # Send WhatsApp
    log = engine.send(
        event_type='ABSENCE',
        channel='WHATSAPP',
        context=context,
        recipient_identifier=student.parent_phone,
        recipient_type='PARENT',
        student=student,
    )

    # Also create in-app notification for admins
    from users.models import User
    admins = User.objects.filter(
        school=school,
        role__in=['SCHOOL_ADMIN', 'PRINCIPAL'],
    )
    for admin_user in admins[:5]:  # Limit to prevent spam
        engine.send(
            event_type='ABSENCE',
            channel='IN_APP',
            context=context,
            recipient_identifier=str(admin_user.id),
            recipient_type='ADMIN',
            recipient_user=admin_user,
            student=student,
            title=f"Absence: {student.name} ({student.class_obj.name})",
            body=f"{student.name} was marked absent on {context['date']}",
        )

    return log


def trigger_fee_reminder(school, month, year):
    """
    Send fee reminders to parents of students with unpaid fees.

    Args:
        school: School instance
        month: Month number (1-12)
        year: Year (e.g. 2025)
    """
    config = _get_config(school)
    if config and not config.fee_reminder_enabled:
        logger.info(f"Fee reminders disabled for {school.name}, skipping")
        return 0

    from finance.models import FeePayment
    from .engine import NotificationEngine

    engine = NotificationEngine(school)

    unpaid = FeePayment.objects.filter(
        school=school,
        month=month,
        year=year,
        status__in=['PENDING', 'PARTIAL'],
    ).select_related('student', 'student__class_obj')

    sent = 0
    for payment in unpaid:
        student = payment.student
        if not student.parent_phone:
            continue

        context = {
            'student_name': student.name,
            'class_name': student.class_obj.name,
            'month': timezone.datetime(year, month, 1).strftime('%B %Y'),
            'amount_due': str(payment.amount_due),
            'amount_paid': str(payment.amount_paid),
            'school_name': school.name,
        }

        engine.send(
            event_type='FEE_DUE',
            channel='WHATSAPP',
            context=context,
            recipient_identifier=student.parent_phone,
            recipient_type='PARENT',
            student=student,
        )
        sent += 1

    logger.info(f"Fee reminders sent: {sent} for {school.name} ({month}/{year})")
    return sent


def trigger_fee_overdue(school, month, year):
    """
    Send overdue fee alerts for payments not received after the due period.
    """
    config = _get_config(school)
    if config and not config.fee_overdue_enabled:
        logger.info(f"Fee overdue alerts disabled for {school.name}, skipping")
        return 0

    from finance.models import FeePayment
    from .engine import NotificationEngine

    engine = NotificationEngine(school)

    overdue = FeePayment.objects.filter(
        school=school,
        month=month,
        year=year,
        status='PENDING',
        amount_paid=0,
    ).select_related('student', 'student__class_obj')

    sent = 0
    for payment in overdue:
        student = payment.student
        if not student.parent_phone:
            continue

        context = {
            'student_name': student.name,
            'class_name': student.class_obj.name,
            'month': timezone.datetime(year, month, 1).strftime('%B %Y'),
            'amount_due': str(payment.amount_due),
            'school_name': school.name,
        }

        engine.send(
            event_type='FEE_OVERDUE',
            channel='WHATSAPP',
            context=context,
            recipient_identifier=student.parent_phone,
            recipient_type='PARENT',
            student=student,
        )
        sent += 1

    logger.info(f"Fee overdue alerts sent: {sent} for {school.name} ({month}/{year})")
    return sent


def trigger_exam_result(student, exam):
    """
    Notify parent when exam results are published.
    """
    from .engine import NotificationEngine

    school = student.school

    config = _get_config(school)
    if config and not config.exam_result_enabled:
        logger.info(f"Exam result notifications disabled for {school.name}, skipping")
        return None

    if not student.parent_phone:
        return None

    engine = NotificationEngine(school)

    context = {
        'student_name': student.name,
        'class_name': student.class_obj.name,
        'exam_name': exam.name if hasattr(exam, 'name') else str(exam),
        'school_name': school.name,
    }

    return engine.send(
        event_type='EXAM_RESULT',
        channel='WHATSAPP',
        context=context,
        recipient_identifier=student.parent_phone,
        recipient_type='PARENT',
        student=student,
    )


def trigger_general(school, title, body, recipient_users=None):
    """
    Send a general announcement to staff/admins.

    Args:
        school: School instance
        title: Notification title
        body: Notification body
        recipient_users: List of User objects (defaults to all admins)
    """
    from users.models import User
    from .engine import NotificationEngine

    engine = NotificationEngine(school)

    if recipient_users is None:
        recipient_users = User.objects.filter(
            school=school,
            role__in=['SCHOOL_ADMIN', 'PRINCIPAL', 'TEACHER'],
        )

    sent = 0
    for user in recipient_users:
        engine.send(
            event_type='GENERAL',
            channel='IN_APP',
            context={},
            recipient_identifier=str(user.id),
            recipient_type='STAFF',
            recipient_user=user,
            title=title,
            body=body,
        )
        sent += 1

    return sent
