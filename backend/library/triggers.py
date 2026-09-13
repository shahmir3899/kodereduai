"""
Library notification triggers — admin on-demand only (see notifications'
RunNotificationJobView pattern), not Celery Beat.
"""

import logging
from datetime import timedelta

from django.utils import timezone

logger = logging.getLogger(__name__)


def trigger_book_due_reminders(school, due_window_days=2):
    """
    Notify borrowers of issued library books that are due within
    due_window_days, or already overdue. Student borrowers' parents (and the
    student's own portal account) are notified via IN_APP; staff borrowers are
    notified directly. Flips ISSUED -> OVERDUE on the way past, matching the
    STATUS_CHOICES already used by the "overdue" filters in library/views.py.
    """
    from notifications.models import SchoolNotificationConfig, NotificationLog
    from notifications.recipients import get_parent_users_for_student, get_student_user
    from notifications.engine import NotificationEngine
    from .models import BookIssue

    config = SchoolNotificationConfig.objects.filter(school=school).first()
    if config and not config.library_due_reminder_enabled:
        logger.info(f"Library due reminders disabled for {school.name}, skipping")
        return 0

    today = timezone.localdate()
    window_end = today + timedelta(days=due_window_days)
    issues = (
        BookIssue.objects
        .filter(school=school, status='ISSUED', due_date__lte=window_end)
        .select_related('book', 'student', 'staff')
    )
    if not issues.exists():
        return 0

    engine = NotificationEngine(school)
    sent = 0
    for issue in issues:
        overdue = issue.due_date < today
        if overdue:
            # Flip status now that we're actually looking at it, matching the
            # existing ad-hoc overdue filters (library/views.py) that treat
            # due_date < today as overdue for any still-ISSUED row.
            issue.status = 'OVERDUE'
            issue.save(update_fields=['status'])

        if overdue:
            title = f"Book Overdue: {issue.book.title}"
            body = f"'{issue.book.title}' was due on {issue.due_date} and is now overdue. Please return it."
        else:
            title = f"Book Due Soon: {issue.book.title}"
            body = f"'{issue.book.title}' is due on {issue.due_date}. Please return it on time."

        recipients = []
        if issue.student_id:
            recipients.extend(
                (user, 'PARENT', issue.student) for user in get_parent_users_for_student(issue.student)
            )
            student_user = get_student_user(issue.student)
            if student_user:
                recipients.append((student_user, 'PARENT', issue.student))
        elif issue.staff_id:
            staff_user = getattr(issue.staff, 'user', None)
            if staff_user:
                recipients.append((staff_user, 'STAFF', None))

        for recipient_user, recipient_type, student in recipients:
            try:
                already_sent_filters = {
                    'school': school,
                    'event_type': 'LIBRARY_OVERDUE',
                    'channel': 'IN_APP',
                    'recipient_user': recipient_user,
                    'title': title,
                    'body': body,
                    'created_at__date': today,
                    'status__in': ['PENDING', 'SCHEDULED', 'SENT', 'DELIVERED', 'READ'],
                }
                if student is not None:
                    already_sent_filters['student'] = student
                if NotificationLog.objects.filter(**already_sent_filters).exists():
                    continue
                engine.send(
                    event_type='LIBRARY_OVERDUE', channel='IN_APP', context={},
                    recipient_identifier=str(recipient_user.id), recipient_type=recipient_type,
                    recipient_user=recipient_user, student=student, title=title, body=body,
                )
                sent += 1
            except Exception as e:
                logger.error(f"Library due reminder failed for issue {issue.id}: {e}")

    logger.info(f"Library due/overdue notifications sent: {sent} for {school.name}")
    return sent
