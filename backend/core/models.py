from django.db import models
from django.conf import settings
from django.utils import timezone


class BackgroundTask(models.Model):
    """Tracks background Celery tasks for user-facing status and progress."""

    class Status(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        IN_PROGRESS = 'IN_PROGRESS', 'In Progress'
        SUCCESS = 'SUCCESS', 'Success'
        FAILED = 'FAILED', 'Failed'

    class TaskType(models.TextChoices):
        REPORT_GENERATION = 'REPORT_GENERATION', 'Report Generation'
        PAYSLIP_GENERATION = 'PAYSLIP_GENERATION', 'Payslip Generation'
        TIMETABLE_GENERATION = 'TIMETABLE_GENERATION', 'Timetable Generation'
        FEE_GENERATION = 'FEE_GENERATION', 'Fee Generation'
        BULK_PROMOTION = 'BULK_PROMOTION', 'Bulk Promotion'
        PROMOTION_ADVISOR = 'PROMOTION_ADVISOR', 'Promotion Advisor'
        FACE_ATTENDANCE = 'FACE_ATTENDANCE', 'Face Attendance Processing'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='background_tasks',
    )
    celery_task_id = models.CharField(max_length=255, unique=True, db_index=True)
    task_type = models.CharField(max_length=30, choices=TaskType.choices)
    title = models.CharField(max_length=255)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
    )
    progress_current = models.PositiveIntegerField(default=0)
    progress_total = models.PositiveIntegerField(default=0)
    result_data = models.JSONField(null=True, blank=True)
    error_message = models.TextField(blank=True, default='')
    triggered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='background_tasks',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['school', 'triggered_by', '-created_at']),
        ]

    def __str__(self):
        return f"[{self.task_type}] {self.title} ({self.status})"


class AIJob(models.Model):
    class JobType(models.TextChoices):
        GENERATE_QUESTIONS = 'generate_questions', 'Generate Questions'
        GENERATE_LESSON = 'generate_lesson', 'Generate Lesson Plan'
        SUGGEST_TOC = 'suggest_toc', 'Suggest TOC'
        EMBED_CONTENT = 'embed_content', 'Embed Content'
        CLASSIFY_BLOOM = 'classify_bloom', 'Classify Bloom Level'

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        SUCCESS = 'success', 'Success'
        FAILED = 'failed', 'Failed'

    job_type = models.CharField(max_length=40, choices=JobType.choices)
    triggered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='ai_jobs',
    )
    school = models.ForeignKey(
        'schools.School',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='ai_jobs',
    )
    input_data = models.JSONField()
    output_data = models.JSONField(null=True, blank=True)
    model_used = models.CharField(max_length=100)
    tokens_used = models.IntegerField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    accepted = models.BooleanField(null=True, blank=True)
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['job_type', 'status']),
            models.Index(fields=['school', 'status']),
        ]

    def __str__(self):
        return f'[{self.job_type}] {self.model_used} ({self.status})'


class QueuedJob(models.Model):
    """Internal DB-backed queue entry linked to a BackgroundTask."""

    class Status(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        RUNNING = 'RUNNING', 'Running'
        SUCCESS = 'SUCCESS', 'Success'
        FAILED = 'FAILED', 'Failed'
        CANCELLED = 'CANCELLED', 'Cancelled'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='queued_jobs',
    )
    background_task = models.OneToOneField(
        BackgroundTask,
        on_delete=models.CASCADE,
        related_name='queued_job',
    )
    callable_path = models.CharField(max_length=255)
    task_args = models.JSONField(default=list, blank=True)
    task_kwargs = models.JSONField(default=dict, blank=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
    )
    priority = models.PositiveSmallIntegerField(default=100)
    attempt_count = models.PositiveSmallIntegerField(default=0)
    max_attempts = models.PositiveSmallIntegerField(default=3)
    scheduled_for = models.DateTimeField(default=timezone.now)
    locked_at = models.DateTimeField(null=True, blank=True)
    lock_expires_at = models.DateTimeField(null=True, blank=True)
    last_heartbeat_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True, default='')
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    triggered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='queued_jobs',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['priority', 'scheduled_for', 'id']
        indexes = [
            models.Index(fields=['status', 'scheduled_for', 'priority']),
            models.Index(fields=['status', 'lock_expires_at']),
            models.Index(fields=['school', 'status', '-created_at']),
        ]

    def __str__(self):
        return f"{self.callable_path} ({self.status})"


class AdminActionLog(models.Model):
    """
    Minimal audit trail for super-admin actions taken in the Platform
    Administration dashboard (school activate/deactivate, org/membership
    delete, user password reset, etc). Intentionally a single flat table —
    not django-simple-history/django-auditlog — since only a handful of
    action types need tracking here, not full model versioning.
    """
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='admin_action_logs',
    )
    action = models.CharField(max_length=50)
    target_type = models.CharField(max_length=50)
    target_id = models.CharField(max_length=50, blank=True, default='')
    target_repr = models.CharField(max_length=255, blank=True, default='')
    metadata = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['-created_at']),
            models.Index(fields=['actor', '-created_at']),
            models.Index(fields=['target_type', 'target_id']),
        ]

    def __str__(self):
        who = self.actor.username if self.actor else 'unknown'
        return f"{who} {self.action} {self.target_type}:{self.target_id}"
