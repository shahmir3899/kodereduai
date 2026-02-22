"""
Notification models for multi-channel school notifications.
"""

from django.db import models
from django.conf import settings


class NotificationTemplate(models.Model):
    """
    Reusable notification message templates with placeholder support.
    School=null means system-wide default template.
    """

    EVENT_TYPE_CHOICES = [
        ('ABSENCE', 'Absence Alert'),
        ('FEE_DUE', 'Fee Due Reminder'),
        ('FEE_OVERDUE', 'Fee Overdue Alert'),
        ('EXAM_RESULT', 'Exam Result Published'),
        ('GENERAL', 'General Announcement'),
        ('CUSTOM', 'Custom Message'),
        ('TRANSPORT_UPDATE', 'Transport Update'),
        ('LIBRARY_OVERDUE', 'Library Overdue Reminder'),
        ('ASSIGNMENT_DUE', 'Assignment Due Reminder'),
    ]

    CHANNEL_CHOICES = [
        ('WHATSAPP', 'WhatsApp'),
        ('SMS', 'SMS'),
        ('IN_APP', 'In-App'),
        ('EMAIL', 'Email'),
        ('PUSH', 'Push Notification'),
    ]

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='notification_templates',
        null=True,
        blank=True,
        help_text='Null = system-wide default template',
    )
    name = models.CharField(max_length=100)
    event_type = models.CharField(max_length=20, choices=EVENT_TYPE_CHOICES)
    channel = models.CharField(max_length=20, choices=CHANNEL_CHOICES)
    subject_template = models.CharField(
        max_length=200,
        blank=True,
        default='',
        help_text='Title/subject line with {{placeholders}}',
    )
    body_template = models.TextField(
        help_text='Message body with {{student_name}}, {{class_name}}, {{date}}, etc.',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['event_type', 'name']
        verbose_name = 'Notification Template'
        verbose_name_plural = 'Notification Templates'

    def __str__(self):
        scope = self.school.name if self.school else 'System'
        return f"{self.name} ({self.get_event_type_display()} / {self.get_channel_display()}) - {scope}"

    def render(self, context: dict) -> dict:
        """Render subject and body by replacing {{placeholder}} with context values."""
        subject = self.subject_template
        body = self.body_template
        for key, value in context.items():
            placeholder = '{{' + key + '}}'
            subject = subject.replace(placeholder, str(value))
            body = body.replace(placeholder, str(value))
        return {'subject': subject, 'body': body}


class NotificationLog(models.Model):
    """
    Tracks every notification sent or attempted.
    """

    STATUS_CHOICES = [
        ('PENDING', 'Pending'),
        ('SCHEDULED', 'Scheduled'),
        ('SENT', 'Sent'),
        ('DELIVERED', 'Delivered'),
        ('FAILED', 'Failed'),
        ('READ', 'Read'),
    ]

    RECIPIENT_TYPE_CHOICES = [
        ('PARENT', 'Parent'),
        ('STAFF', 'Staff'),
        ('ADMIN', 'Admin'),
    ]

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='notification_logs',
    )
    template = models.ForeignKey(
        NotificationTemplate,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='logs',
    )
    channel = models.CharField(max_length=20, choices=NotificationTemplate.CHANNEL_CHOICES)
    event_type = models.CharField(max_length=20, choices=NotificationTemplate.EVENT_TYPE_CHOICES)
    recipient_type = models.CharField(max_length=20, choices=RECIPIENT_TYPE_CHOICES)
    recipient_identifier = models.CharField(
        max_length=200,
        help_text='Phone number, user ID, or email',
    )
    recipient_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='notifications_received',
    )
    student = models.ForeignKey(
        'students.Student',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='notification_logs',
    )
    title = models.CharField(max_length=200, blank=True, default='')
    body = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    scheduled_for = models.DateTimeField(
        null=True,
        blank=True,
        help_text='When to dispatch this notification (for AI-optimized scheduling)',
    )
    metadata = models.JSONField(
        default=dict,
        blank=True,
        help_text='API response, error details, extra context',
    )
    sent_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Notification Log'
        verbose_name_plural = 'Notification Logs'
        indexes = [
            models.Index(fields=['school', 'status']),
            models.Index(fields=['recipient_user', 'status']),
            models.Index(fields=['school', 'event_type']),
        ]

    def __str__(self):
        return f"{self.get_channel_display()} → {self.recipient_identifier} ({self.get_status_display()})"


class NotificationPreference(models.Model):
    """
    Per-user or per-student notification opt-in/opt-out preferences.
    """

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='notification_preferences',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='notification_preferences',
        help_text='For staff notification preferences',
    )
    student = models.ForeignKey(
        'students.Student',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='notification_preferences',
        help_text='For parent notification preferences (keyed by student)',
    )
    channel = models.CharField(max_length=20, choices=NotificationTemplate.CHANNEL_CHOICES)
    event_type = models.CharField(max_length=20, choices=NotificationTemplate.EVENT_TYPE_CHOICES)
    is_enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Notification Preference'
        verbose_name_plural = 'Notification Preferences'
        constraints = [
            models.UniqueConstraint(
                fields=['school', 'user', 'channel', 'event_type'],
                condition=models.Q(user__isnull=False),
                name='unique_user_notification_pref',
            ),
            models.UniqueConstraint(
                fields=['school', 'student', 'channel', 'event_type'],
                condition=models.Q(student__isnull=False),
                name='unique_student_notification_pref',
            ),
        ]

    def __str__(self):
        target = self.user or self.student or 'Global'
        status = 'ON' if self.is_enabled else 'OFF'
        return f"{target} - {self.get_channel_display()}/{self.get_event_type_display()}: {status}"


class SchoolNotificationConfig(models.Model):
    """
    School-level notification configuration.
    """

    school = models.OneToOneField(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='notification_config',
    )
    whatsapp_enabled = models.BooleanField(default=False)
    sms_enabled = models.BooleanField(default=False)
    in_app_enabled = models.BooleanField(default=True)
    email_enabled = models.BooleanField(default=False)
    push_enabled = models.BooleanField(default=True)
    quiet_hours_start = models.TimeField(
        null=True,
        blank=True,
        help_text='Do not send notifications before this time',
    )
    quiet_hours_end = models.TimeField(
        null=True,
        blank=True,
        help_text='Do not send notifications after this time',
    )
    fee_reminder_day = models.IntegerField(
        default=5,
        help_text='Day of month to send fee reminders (1-28)',
    )
    daily_absence_summary_time = models.TimeField(
        null=True,
        blank=True,
        help_text='Time to send daily absence summary to admins',
    )
    smart_scheduling_enabled = models.BooleanField(
        default=False,
        help_text='When enabled, AI analyzes read patterns to schedule non-urgent notifications at optimal times',
    )

    # Automated trigger toggles
    absence_notification_enabled = models.BooleanField(
        default=True,
        help_text='Send notifications to parents when a student is marked absent',
    )
    fee_reminder_enabled = models.BooleanField(
        default=True,
        help_text='Send monthly fee reminders for unpaid/partial fees',
    )
    fee_overdue_enabled = models.BooleanField(
        default=True,
        help_text='Send alerts when fees are completely overdue',
    )
    exam_result_enabled = models.BooleanField(
        default=True,
        help_text='Notify parents when exam results are published',
    )
    daily_absence_summary_enabled = models.BooleanField(
        default=False,
        help_text='Send daily absence summary to admins',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'School Notification Config'
        verbose_name_plural = 'School Notification Configs'

    def __str__(self):
        return f"Notification Config - {self.school.name}"
