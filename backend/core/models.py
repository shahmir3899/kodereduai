from django.db import models
from django.conf import settings


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
