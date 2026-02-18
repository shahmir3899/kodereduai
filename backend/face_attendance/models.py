"""
Face attendance models for camera-based multi-student attendance.

Three models:
- FaceAttendanceSession: One per capture event (group photo)
- StudentFaceEmbedding: Face embeddings for enrolled students
- FaceDetectionResult: Individual faces detected in a session image
"""

import uuid

from django.conf import settings
from django.db import models


class FaceAttendanceSession(models.Model):
    """
    Represents a single face-attendance capture event.

    Workflow:
    1. Teacher captures group photo → status = UPLOADING
    2. Image uploaded, session created → status = PROCESSING
    3. Celery task detects faces, matches → status = NEEDS_REVIEW
    4. Teacher reviews and confirms → status = CONFIRMED
    5. AttendanceRecords created (source=FACE_CAMERA)
    """

    class Status(models.TextChoices):
        UPLOADING = 'UPLOADING', 'Uploading'
        PROCESSING = 'PROCESSING', 'Processing'
        NEEDS_REVIEW = 'NEEDS_REVIEW', 'Needs Review'
        CONFIRMED = 'CONFIRMED', 'Confirmed'
        FAILED = 'FAILED', 'Failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Tenant and class association
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='face_attendance_sessions',
    )
    class_obj = models.ForeignKey(
        'students.Class',
        on_delete=models.CASCADE,
        related_name='face_attendance_sessions',
        verbose_name='Class',
    )
    academic_year = models.ForeignKey(
        'academic_sessions.AcademicYear',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='face_attendance_sessions',
    )
    date = models.DateField(help_text='Attendance date')

    # Processing state
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.UPLOADING,
    )
    error_message = models.TextField(blank=True)

    # Image reference (Supabase URL)
    image_url = models.URLField(max_length=500)

    # Processing results summary
    total_faces_detected = models.PositiveIntegerField(default=0)
    faces_matched = models.PositiveIntegerField(default=0)
    faces_flagged = models.PositiveIntegerField(default=0)
    faces_ignored = models.PositiveIntegerField(default=0)

    # Confidence thresholds used for this session (stored for audit)
    thresholds_used = models.JSONField(
        default=dict,
        blank=True,
        help_text='Thresholds at processing time: {"high": 0.40, "medium": 0.55}',
    )

    # Celery task tracking
    celery_task_id = models.CharField(max_length=255, blank=True)

    # Audit trail
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='face_sessions_created',
    )
    confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='face_sessions_confirmed',
    )
    confirmed_at = models.DateTimeField(null=True, blank=True)

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Face Attendance Session'
        verbose_name_plural = 'Face Attendance Sessions'
        indexes = [
            models.Index(fields=['school', 'class_obj', 'date']),
            models.Index(fields=['status']),
            models.Index(fields=['-created_at']),
        ]

    def __str__(self):
        return f'{self.class_obj} - {self.date} ({self.get_status_display()})'

    @property
    def is_confirmed(self):
        return self.status == self.Status.CONFIRMED

    @property
    def can_be_confirmed(self):
        return self.status in [self.Status.NEEDS_REVIEW]


class StudentFaceEmbedding(models.Model):
    """
    Stores a face embedding for a student.

    Supports multiple embeddings per student (different angles, lighting).
    Embeddings are 128-dimensional float64 arrays (dlib) stored as bytes.
    """

    student = models.ForeignKey(
        'students.Student',
        on_delete=models.CASCADE,
        related_name='face_embeddings',
    )
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='student_face_embeddings',
        help_text='Denormalized for fast class-scoped queries',
    )

    # The embedding vector stored as bytes (numpy float64 array)
    embedding = models.BinaryField(
        help_text='128-dimensional float64 numpy array stored as bytes',
    )
    embedding_version = models.CharField(
        max_length=20,
        default='dlib_v1',
        help_text='Model version used to generate this embedding',
    )

    # Source metadata
    source_image_url = models.URLField(
        max_length=500,
        blank=True,
        help_text='Original photo used for enrollment',
    )
    quality_score = models.FloatField(
        default=0,
        help_text='Face quality score 0-1 (size, blur, lighting)',
    )

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Student Face Embedding'
        verbose_name_plural = 'Student Face Embeddings'
        indexes = [
            models.Index(fields=['school', 'is_active']),
            models.Index(fields=['student', 'is_active']),
        ]

    def __str__(self):
        return f'{self.student.name} - {self.embedding_version} (q={self.quality_score:.2f})'


class FaceDetectionResult(models.Model):
    """
    An individual face detected in a session image.

    Links a detected face to a matched student (or marks it as unmatched).
    Stores bounding box, cropped image, confidence, and alternatives.
    """

    class MatchStatus(models.TextChoices):
        AUTO_MATCHED = 'AUTO_MATCHED', 'Auto Matched (High Confidence)'
        FLAGGED = 'FLAGGED', 'Flagged (Medium Confidence)'
        IGNORED = 'IGNORED', 'Ignored (Low Confidence)'
        MANUALLY_MATCHED = 'MANUALLY_MATCHED', 'Manually Matched'
        REMOVED = 'REMOVED', 'Removed by Teacher'

    session = models.ForeignKey(
        FaceAttendanceSession,
        on_delete=models.CASCADE,
        related_name='detections',
    )

    # Detection data
    face_index = models.PositiveIntegerField(
        help_text='Order of face in the image (0-based)',
    )
    bounding_box = models.JSONField(
        help_text='{"top": y, "right": x, "bottom": y, "left": x}',
    )
    face_crop_url = models.URLField(
        max_length=500,
        blank=True,
        help_text='URL of cropped face image in Supabase',
    )
    quality_score = models.FloatField(
        default=0,
        help_text='Face quality score 0-1',
    )
    embedding = models.BinaryField(
        null=True,
        blank=True,
        help_text='128-d embedding stored for debugging/reprocessing',
    )

    # Match result
    matched_student = models.ForeignKey(
        'students.Student',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='face_detections',
    )
    confidence = models.FloatField(
        default=0,
        help_text='Match confidence 0-100 percentage',
    )
    match_status = models.CharField(
        max_length=20,
        choices=MatchStatus.choices,
        default=MatchStatus.IGNORED,
    )
    match_distance = models.FloatField(
        null=True,
        blank=True,
        help_text='Raw L2 distance from face_recognition (lower = better match)',
    )

    # Runner-up matches for review UI
    alternative_matches = models.JSONField(
        default=list,
        blank=True,
        help_text='[{"student_id": 5, "name": "...", "confidence": 72.1, "distance": 0.38}]',
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('session', 'face_index')
        ordering = ['session', 'face_index']
        verbose_name = 'Face Detection Result'
        verbose_name_plural = 'Face Detection Results'

    def __str__(self):
        student_name = self.matched_student.name if self.matched_student else 'Unknown'
        return f'Face #{self.face_index} → {student_name} ({self.confidence:.1f}%)'
