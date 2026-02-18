from django.db import models
from django.conf import settings


class AttendanceUpload(models.Model):
    """
    Represents an uploaded attendance register image for AI processing.

    Workflow:
    1. School Admin uploads image -> status = PROCESSING
    2. Celery task processes OCR + LLM -> status = REVIEW_REQUIRED
    3. Admin reviews and confirms -> status = CONFIRMED
    4. AttendanceRecords are created
    5. WhatsApp notifications sent (if enabled)
    """

    class Status(models.TextChoices):
        PROCESSING = 'PROCESSING', 'Processing'
        REVIEW_REQUIRED = 'REVIEW_REQUIRED', 'Review Required'
        CONFIRMED = 'CONFIRMED', 'Confirmed'
        FAILED = 'FAILED', 'Failed'

    # Tenant and class association
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='attendance_uploads'
    )
    class_obj = models.ForeignKey(
        'students.Class',
        on_delete=models.CASCADE,
        related_name='attendance_uploads',
        verbose_name='Class'
    )
    academic_year = models.ForeignKey(
        'academic_sessions.AcademicYear',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='attendance_uploads',
        help_text="Academic year this attendance belongs to (auto-resolved if not provided)"
    )

    # Date for this attendance
    date = models.DateField(help_text="Date of the attendance register")

    # Image storage (legacy - kept for backwards compatibility)
    # New uploads should use AttendanceUploadImage model for multi-page support
    image_url = models.URLField(
        max_length=500,
        blank=True,
        help_text="URL of the uploaded register image (legacy single-image)"
    )

    # AI Processing results
    ai_output_json = models.JSONField(
        null=True,
        blank=True,
        help_text="JSON output from LLM: {matched: [], unmatched: [], confidence: 0.92}"
    )
    ocr_raw_text = models.TextField(
        blank=True,
        help_text="Raw text extracted by OCR"
    )
    structured_table_json = models.JSONField(
        null=True,
        blank=True,
        help_text="Structured table extracted from OCR: {students: [], date_columns: {}}"
    )
    confidence_score = models.DecimalField(
        max_digits=4,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="AI confidence score (0.00 - 1.00)"
    )

    # Status tracking
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PROCESSING
    )
    error_message = models.TextField(
        blank=True,
        help_text="Error message if processing failed"
    )

    # Audit trail
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='uploads_created'
    )
    confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='uploads_confirmed'
    )
    confirmed_at = models.DateTimeField(null=True, blank=True)

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'class_obj', 'date')
        ordering = ['-created_at']
        verbose_name = 'Attendance Upload'
        verbose_name_plural = 'Attendance Uploads'
        indexes = [
            models.Index(fields=['status']),
            models.Index(fields=['-created_at']),
            models.Index(fields=['academic_year']),
        ]

    def __str__(self):
        return f"{self.class_obj.name} - {self.date} ({self.get_status_display()})"

    @property
    def is_confirmed(self) -> bool:
        return self.status == self.Status.CONFIRMED

    @property
    def can_be_confirmed(self) -> bool:
        return self.status in [self.Status.REVIEW_REQUIRED, self.Status.PROCESSING]

    def get_matched_students(self) -> list:
        """Return list of matched student data from AI output."""
        if not self.ai_output_json:
            return []
        return self.ai_output_json.get('matched', [])

    def get_unmatched_entries(self) -> list:
        """Return list of unmatched entries from AI output."""
        if not self.ai_output_json:
            return []
        return self.ai_output_json.get('unmatched', [])

    def get_all_image_urls(self) -> list:
        """Get all image URLs for this upload (both legacy and multi-page)."""
        urls = []
        # Legacy single image
        if self.image_url:
            urls.append({'url': self.image_url, 'page': 1, 'id': None})
        # Multi-page images
        for img in self.images.all().order_by('page_number'):
            urls.append({
                'url': img.image_url,
                'page': img.page_number,
                'id': img.id
            })
        return urls if urls else [{'url': self.image_url, 'page': 1, 'id': None}]

    @property
    def total_pages(self) -> int:
        """Get total number of pages/images."""
        count = self.images.count()
        if count > 0:
            return count
        return 1 if self.image_url else 0


class AttendanceUploadImage(models.Model):
    """
    Individual image/page for a multi-page attendance upload.

    Supports registers that span multiple pages.
    Each page is processed separately, then results are merged.
    """
    upload = models.ForeignKey(
        'AttendanceUpload',
        on_delete=models.CASCADE,
        related_name='images'
    )
    image_url = models.URLField(
        max_length=500,
        help_text="URL of this page image (Supabase)"
    )
    page_number = models.PositiveIntegerField(
        default=1,
        help_text="Page number in the register (1-indexed)"
    )

    # Per-page processing results
    ocr_raw_text = models.TextField(
        blank=True,
        help_text="Raw text extracted from this page"
    )
    structured_table_json = models.JSONField(
        null=True,
        blank=True,
        help_text="Structured table extracted from this page"
    )
    processing_status = models.CharField(
        max_length=20,
        choices=[
            ('PENDING', 'Pending'),
            ('PROCESSING', 'Processing'),
            ('COMPLETED', 'Completed'),
            ('FAILED', 'Failed'),
        ],
        default='PENDING'
    )
    error_message = models.TextField(blank=True)

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['upload', 'page_number']
        unique_together = ('upload', 'page_number')
        verbose_name = 'Upload Image'
        verbose_name_plural = 'Upload Images'

    def __str__(self):
        return f"{self.upload} - Page {self.page_number}"


class AttendanceRecord(models.Model):
    """
    Individual attendance record for a student on a specific date.
    Created after AttendanceUpload is confirmed.
    """

    class AttendanceStatus(models.TextChoices):
        PRESENT = 'PRESENT', 'Present'
        ABSENT = 'ABSENT', 'Absent'

    class Source(models.TextChoices):
        IMAGE_AI = 'IMAGE_AI', 'Image AI'
        MANUAL = 'MANUAL', 'Manual'
        FACE_CAMERA = 'FACE_CAMERA', 'Face Camera'

    # Tenant association
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='attendance_records'
    )
    academic_year = models.ForeignKey(
        'academic_sessions.AcademicYear',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='attendance_records',
        help_text="Academic year this record belongs to"
    )

    # Student and date
    student = models.ForeignKey(
        'students.Student',
        on_delete=models.CASCADE,
        related_name='attendance_records'
    )
    date = models.DateField()

    # Attendance status
    status = models.CharField(
        max_length=10,
        choices=AttendanceStatus.choices
    )

    # Source tracking
    source = models.CharField(
        max_length=20,
        choices=Source.choices,
        default=Source.IMAGE_AI
    )
    upload = models.ForeignKey(
        'AttendanceUpload',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='records',
        help_text="The upload that created this record (if source is IMAGE_AI)"
    )
    face_session = models.ForeignKey(
        'face_attendance.FaceAttendanceSession',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='attendance_records',
        help_text="The face session that created this record (if source is FACE_CAMERA)"
    )

    # Notification tracking
    notification_sent = models.BooleanField(
        default=False,
        help_text="Whether WhatsApp notification was sent for this absence"
    )
    notification_sent_at = models.DateTimeField(null=True, blank=True)

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('student', 'date')
        ordering = ['-date', 'student__class_obj', 'student__roll_number']
        verbose_name = 'Attendance Record'
        verbose_name_plural = 'Attendance Records'
        indexes = [
            models.Index(fields=['school', 'date', 'status']),
            models.Index(fields=['student', 'date']),
        ]

    def __str__(self):
        return f"{self.student.name} - {self.date}: {self.get_status_display()}"

    @property
    def is_absent(self) -> bool:
        return self.status == self.AttendanceStatus.ABSENT


class AttendanceFeedback(models.Model):
    """
    Records differences between AI predictions and human confirmations.
    Used for learning and improving AI accuracy over time.
    """

    class CorrectionType(models.TextChoices):
        FALSE_POSITIVE = 'false_positive', 'AI marked absent but human marked present'
        FALSE_NEGATIVE = 'false_negative', 'AI marked present but human marked absent'
        ROLL_MISMATCH = 'roll_mismatch', 'AI matched wrong student by roll'
        NAME_MISMATCH = 'name_mismatch', 'AI matched wrong student by name'
        MARK_MISREAD = 'mark_misread', 'OCR read mark incorrectly'

    # Tenant association
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='attendance_feedbacks'
    )

    # Reference to the upload
    upload = models.ForeignKey(
        'AttendanceUpload',
        on_delete=models.CASCADE,
        related_name='feedbacks'
    )

    # Student that was corrected
    student = models.ForeignKey(
        'students.Student',
        on_delete=models.CASCADE,
        related_name='attendance_feedbacks',
        null=True,
        blank=True
    )

    # Correction details
    correction_type = models.CharField(
        max_length=20,
        choices=CorrectionType.choices
    )
    ai_prediction = models.CharField(
        max_length=20,
        help_text="What AI predicted (PRESENT/ABSENT)"
    )
    human_correction = models.CharField(
        max_length=20,
        help_text="What human confirmed (PRESENT/ABSENT)"
    )

    # OCR context for learning
    raw_mark = models.CharField(
        max_length=20,
        blank=True,
        help_text="The raw mark text that was misinterpreted"
    )
    ocr_confidence = models.FloatField(
        default=0,
        help_text="OCR confidence for this cell (0-1)"
    )
    match_type = models.CharField(
        max_length=50,
        blank=True,
        help_text="How the student was matched (roll_exact, name_fuzzy_85, etc.)"
    )

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Attendance Feedback'
        verbose_name_plural = 'Attendance Feedbacks'
        indexes = [
            models.Index(fields=['school', 'created_at']),
            models.Index(fields=['correction_type']),
        ]

    def __str__(self):
        return f"{self.school.name} - {self.correction_type} - {self.created_at.date()}"
