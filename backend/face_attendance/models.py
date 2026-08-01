"""
Face attendance models for camera-based multi-student attendance.

Group Photo capture (batch): FaceAttendanceSession, StudentFaceEmbedding,
FaceDetectionResult.

Fixed Camera capture (fixed on-prem camera, live/streaming): FaceCaptureDevice,
FaceAttendanceSchoolConfig, FaceLiveDetectionEvent. See
docs/FACE_ATTENDANCE.md for the full design.
"""

import hashlib
import secrets
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from pgvector.django import VectorField


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

    # The embedding vector stored as bytes (numpy float64 array).
    # Kept alongside embedding_vector during the pgvector migration; matching
    # reads only embedding_vector, this column is scheduled for removal once
    # every environment has been backfilled.
    embedding = models.BinaryField(
        help_text='128-dimensional float64 numpy array stored as bytes (legacy, see embedding_vector)',
    )
    # pgvector column used for matching. Nullable during the backfill window;
    # a later migration will make it required and drop `embedding` above.
    embedding_vector = VectorField(dimensions=128, null=True, blank=True)
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


class FaceAttendanceSchoolConfig(models.Model):
    """
    Per-school settings for face attendance capture methods.

    Confirmed product decision: Group Photo capture, Live Mobile capture,
    and Fixed Camera capture are all unconditionally available to every
    school — no school-level enable/disable gate exists or is wanted for
    any of them. The per-method enable flags this model used to carry (see
    migration 0008_remove_tier_enable_flags for the removed field names)
    were removed, not just defaulted on, since nothing consults them
    anymore. Fixed Camera capture
    has no "enabled" concept at all: whether it's available is derived from
    whether the school has an active, recently-seen FaceCaptureDevice (see
    FaceAttendanceStatusView), not from a flag here. This model still
    exists for genuinely per-school knobs (arrival window, threshold
    overrides) that aren't simple on/off gates.
    """

    school = models.OneToOneField(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='face_attendance_config',
    )
    live_window_start = models.TimeField(
        null=True, blank=True,
        help_text='Arrival window start for live capture methods (semantics not yet enforced)',
    )
    live_window_end = models.TimeField(
        null=True, blank=True,
        help_text='Arrival window end for live capture methods (semantics not yet enforced)',
    )
    threshold_overrides = models.JSONField(
        null=True, blank=True,
        help_text='Optional per-embedding-version threshold overrides (not yet consulted by matching)',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Face Attendance School Config'
        verbose_name_plural = 'Face Attendance School Configs'

    def __str__(self):
        return f'Face Attendance Config — {self.school}'


class FaceCaptureDevice(models.Model):
    """
    An on-prem Fixed Camera capture device registered for a school.

    Authenticates via a hashed API key (X-Device-Key header), not the
    JWT/session auth used by human users — see
    face_attendance.authentication.DeviceKeyAuthentication.

    Scoping is configurable per device: a CLASS-scoped device (e.g. a
    classroom camera) matches only against that class's roster; a
    SCHOOL-scoped device (e.g. an entrance camera) matches against the
    whole school. Exactly one of (scope_type=CLASS + class_obj set) or
    (scope_type=SCHOOL + class_obj null) must hold — enforced by both a
    DB CheckConstraint and clean().
    """

    class ScopeType(models.TextChoices):
        CLASS = 'CLASS', 'Single Class'
        SCHOOL = 'SCHOOL', 'Whole School'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='face_capture_devices',
    )
    name = models.CharField(max_length=100, help_text='e.g. "Front Gate Camera"')
    device_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    api_key_hash = models.CharField(
        max_length=64, editable=False,
        help_text='SHA-256 hex digest of the device API key. The raw key is shown once at creation and never stored.',
    )
    is_active = models.BooleanField(default=True)
    embedding_version = models.CharField(
        max_length=20,
        default='dlib_v1',
        help_text='Fixed per device — a device always emits vectors from one embedding space',
    )
    scope_type = models.CharField(max_length=10, choices=ScopeType.choices)
    class_obj = models.ForeignKey(
        'students.Class',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='face_capture_devices',
        help_text='Required when scope_type=CLASS, must be null when scope_type=SCHOOL',
    )
    last_seen_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='face_capture_devices_created',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Face Capture Device'
        verbose_name_plural = 'Face Capture Devices'
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(scope_type='CLASS', class_obj__isnull=False)
                    | models.Q(scope_type='SCHOOL', class_obj__isnull=True)
                ),
                name='face_capture_device_scope_consistency',
            ),
        ]

    def __str__(self):
        scope = self.class_obj if self.scope_type == self.ScopeType.CLASS else 'whole school'
        return f'{self.name} ({self.school} — {scope})'

    def clean(self):
        super().clean()
        if self.scope_type == self.ScopeType.CLASS and not self.class_obj_id:
            raise ValidationError('A CLASS-scoped device must have a class_obj set.')
        if self.scope_type == self.ScopeType.SCHOOL and self.class_obj_id:
            raise ValidationError('A SCHOOL-scoped device must not have a class_obj set.')
        if self.class_obj_id and self.school_id and self.class_obj.school_id != self.school_id:
            raise ValidationError('class_obj must belong to the same school as the device.')

    @staticmethod
    def hash_api_key(raw_key):
        return hashlib.sha256(raw_key.encode('utf-8')).hexdigest()

    @classmethod
    def generate_api_key(cls):
        """Return (raw_key, key_hash). Only the hash should ever be persisted."""
        raw_key = secrets.token_urlsafe(32)
        return raw_key, cls.hash_api_key(raw_key)


class FaceLiveDetectionEvent(models.Model):
    """
    One match attempt from a live capture method (Live Mobile or Fixed Camera).

    Distinct from FaceAttendanceSession on purpose: a session is "one
    processed photo," this is "one match attempt in a continuous stream" —
    shaped for high write volume during an arrival window rather than
    one-row-per-review-item. Raw embedding vectors are intentionally not
    stored here (biometric-data-retention consideration, see design doc §8/§9.3).
    """

    class CaptureMethod(models.TextChoices):
        LIVE_MOBILE = 'LIVE_MOBILE', 'Live Mobile Capture'
        FIXED_CAMERA = 'FIXED_CAMERA', 'Fixed Camera Capture'

    class MatchStatus(models.TextChoices):
        AUTO_MATCHED = 'AUTO_MATCHED', 'Auto Matched (High Confidence)'
        FLAGGED = 'FLAGGED', 'Flagged (Medium Confidence)'
        IGNORED = 'IGNORED', 'Ignored (Low Confidence)'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='face_live_detection_events',
    )
    class_obj = models.ForeignKey(
        'students.Class',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='face_live_detection_events',
        verbose_name='Class',
        help_text='Set when the source device is CLASS-scoped; null for SCHOOL-scoped devices',
    )
    source_method = models.CharField(max_length=15, choices=CaptureMethod.choices)

    # Exactly one of these is populated depending on source_method.
    device = models.ForeignKey(
        FaceCaptureDevice,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='detection_events',
        help_text='Set for Fixed Camera capture events',
    )
    captured_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='face_live_detection_events_captured',
        help_text='Set for Live Mobile capture events — the teacher/guard whose session posted the embedding',
    )

    embedding_version = models.CharField(max_length=20)
    client_timestamp = models.DateTimeField(help_text='Capture-side clock, as reported by the device/browser')
    received_at = models.DateTimeField(auto_now_add=True)

    matched_student = models.ForeignKey(
        'students.Student',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='face_live_detection_events',
    )
    confidence = models.FloatField(default=0, help_text='Match confidence 0-100 percentage')
    distance = models.FloatField(null=True, blank=True, help_text='Raw L2 distance (lower = better match)')
    match_status = models.CharField(max_length=20, choices=MatchStatus.choices)

    resulted_in_attendance = models.BooleanField(
        default=False,
        help_text='True only for the first AUTO_MATCHED event per (student, date) that wrote the AttendanceRecord',
    )
    attendance_record = models.ForeignKey(
        'attendance.AttendanceRecord',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='face_live_detection_events',
    )

    class Meta:
        ordering = ['-client_timestamp']
        verbose_name = 'Face Live Detection Event'
        verbose_name_plural = 'Face Live Detection Events'
        indexes = [
            models.Index(fields=['school', 'class_obj', 'client_timestamp']),
            models.Index(fields=['school', 'matched_student', 'client_timestamp']),
            models.Index(fields=['match_status']),
        ]

    def __str__(self):
        student_name = self.matched_student.name if self.matched_student else 'Unmatched'
        return f'{self.source_method} @ {self.client_timestamp} → {student_name} ({self.match_status})'


class FaceMatchThresholdSample(models.Model):
    """
    A labeled (distance, correct/incorrect) sample for future threshold
    tuning — see docs/FACE_ATTENDANCE.md section C
    ("faceapi_v1 threshold empirical tuning").

    Deliberately stripped down: no student/class FK, no raw embedding
    vector, no fine-grained timestamp (date only). Once a live-match event
    is reduced to just "how far was it, what did we decide, was that
    right", it's no longer meaningfully biometric/identifying data, which
    is why — unlike FaceLiveDetectionEvent — these rows are kept
    indefinitely rather than purged after 48h. Revisit only if this table
    grows large or a legal/compliance review flags it.

    Only created from operator feedback (see LiveMatchFeedbackView) — the
    operator holding the phone is the only one who can ever know whether a
    Live Mobile match was actually correct, since no image is stored to review
    later.
    """

    class CaptureMethod(models.TextChoices):
        LIVE_MOBILE = 'LIVE_MOBILE', 'Live Mobile Capture'
        FIXED_CAMERA = 'FIXED_CAMERA', 'Fixed Camera Capture'

    class PredictedStatus(models.TextChoices):
        AUTO_MATCHED = 'AUTO_MATCHED', 'Auto Matched (High Confidence)'
        FLAGGED = 'FLAGGED', 'Flagged (Medium Confidence)'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='face_match_threshold_samples',
    )
    source_method = models.CharField(max_length=15, choices=CaptureMethod.choices)
    embedding_version = models.CharField(max_length=20)
    distance = models.FloatField(help_text='Raw L2 distance the system matched on')
    predicted_match_status = models.CharField(max_length=20, choices=PredictedStatus.choices)
    is_correct = models.BooleanField(help_text="Operator's label: was the predicted match actually correct?")
    sample_date = models.DateField(help_text='Date the sample was captured (coarse on purpose)')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Face Match Threshold Sample'
        verbose_name_plural = 'Face Match Threshold Samples'
        indexes = [
            models.Index(fields=['embedding_version', 'predicted_match_status']),
        ]

    def __str__(self):
        verdict = 'correct' if self.is_correct else 'wrong'
        return f'{self.embedding_version} {self.predicted_match_status} d={self.distance:.4f} ({verdict})'
