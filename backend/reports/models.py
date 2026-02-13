from django.db import models
from django.conf import settings


class GeneratedReport(models.Model):
    """Tracks generated reports for download and audit."""

    REPORT_TYPE_CHOICES = [
        ('ATTENDANCE_DAILY', 'Daily Attendance'),
        ('ATTENDANCE_MONTHLY', 'Monthly Attendance'),
        ('ATTENDANCE_TERM', 'Term Attendance'),
        ('FEE_COLLECTION', 'Fee Collection Summary'),
        ('FEE_DEFAULTERS', 'Fee Defaulters List'),
        ('FEE_RECEIPT', 'Fee Receipt'),
        ('STUDENT_PROGRESS', 'Student Progress Report'),
        ('CLASS_RESULT', 'Class Result Summary'),
        ('STUDENT_COMPREHENSIVE', 'Student Comprehensive Report'),
    ]

    FORMAT_CHOICES = [
        ('PDF', 'PDF'),
        ('XLSX', 'Excel'),
    ]

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='generated_reports',
    )
    report_type = models.CharField(max_length=30, choices=REPORT_TYPE_CHOICES)
    title = models.CharField(max_length=200)
    parameters = models.JSONField(default=dict, blank=True)
    file_url = models.URLField(blank=True, default='')
    file_content = models.BinaryField(null=True, blank=True, help_text='In-memory report for direct download')
    format = models.CharField(max_length=10, choices=FORMAT_CHOICES, default='PDF')
    generated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Generated Report'
        verbose_name_plural = 'Generated Reports'

    def __str__(self):
        return f"{self.title} ({self.get_format_display()}) - {self.created_at.strftime('%Y-%m-%d')}"
