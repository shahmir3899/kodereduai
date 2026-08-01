from django.contrib import admin, messages

from .models import (
    FaceAttendanceSession, StudentFaceEmbedding, FaceDetectionResult,
    FaceAttendanceSchoolConfig, FaceCaptureDevice, FaceLiveDetectionEvent,
    FaceMatchThresholdSample,
)


@admin.register(FaceAttendanceSession)
class FaceAttendanceSessionAdmin(admin.ModelAdmin):
    list_display = ('id', 'school', 'class_obj', 'date', 'status', 'total_faces_detected', 'faces_matched', 'created_at')
    list_filter = ('status', 'school', 'date')
    search_fields = ('class_obj__name',)
    readonly_fields = ('id', 'created_at', 'updated_at', 'confirmed_at')


@admin.register(StudentFaceEmbedding)
class StudentFaceEmbeddingAdmin(admin.ModelAdmin):
    list_display = ('student', 'school', 'embedding_version', 'quality_score', 'is_active', 'created_at')
    list_filter = ('is_active', 'embedding_version', 'school')
    search_fields = ('student__name',)


@admin.register(FaceDetectionResult)
class FaceDetectionResultAdmin(admin.ModelAdmin):
    list_display = ('session', 'face_index', 'matched_student', 'confidence', 'match_status')
    list_filter = ('match_status',)
    search_fields = ('matched_student__name',)


@admin.register(FaceAttendanceSchoolConfig)
class FaceAttendanceSchoolConfigAdmin(admin.ModelAdmin):
    list_display = ('school', 'live_window_start', 'live_window_end', 'updated_at')
    search_fields = ('school__name',)


@admin.register(FaceCaptureDevice)
class FaceCaptureDeviceAdmin(admin.ModelAdmin):
    """
    No self-service pairing flow yet (design doc §9.4 — fine for a pilot).
    Creating a device here generates its API key and shows it exactly once
    in a flash message; it is never displayed or recoverable again.
    """

    list_display = (
        'name', 'school', 'scope_type', 'class_obj', 'embedding_version',
        'is_active', 'last_seen_at', 'created_at',
    )
    list_filter = ('scope_type', 'is_active', 'school')
    search_fields = ('name', 'school__name')
    readonly_fields = ('device_id', 'api_key_hash', 'last_seen_at', 'created_by', 'created_at')

    def save_model(self, request, obj, form, change):
        is_new = obj.pk is None
        if is_new:
            raw_key, key_hash = FaceCaptureDevice.generate_api_key()
            obj.api_key_hash = key_hash
            obj.created_by = request.user
        obj.full_clean()
        super().save_model(request, obj, form, change)
        if is_new:
            self.message_user(
                request,
                f'Device key for "{obj.name}" (copy it now — it will not be shown again): {raw_key}',
                level=messages.WARNING,
            )


@admin.register(FaceLiveDetectionEvent)
class FaceLiveDetectionEventAdmin(admin.ModelAdmin):
    list_display = (
        'source_method', 'school', 'class_obj', 'matched_student',
        'match_status', 'resulted_in_attendance', 'client_timestamp',
    )
    list_filter = ('source_method', 'match_status', 'resulted_in_attendance', 'school')
    search_fields = ('matched_student__name',)
    readonly_fields = ('id', 'received_at')


@admin.register(FaceMatchThresholdSample)
class FaceMatchThresholdSampleAdmin(admin.ModelAdmin):
    """
    Read-only in practice: rows are only ever created via operator feedback
    on the live-capture page, never edited by hand. Kept indefinitely (see
    model docstring) — this is the primary way to eyeball accumulating
    data before a future threshold-tuning analysis pass.
    """

    list_display = (
        'embedding_version', 'predicted_match_status', 'distance',
        'is_correct', 'source_method', 'school', 'sample_date',
    )
    list_filter = ('embedding_version', 'predicted_match_status', 'is_correct', 'source_method', 'school')
    readonly_fields = ('created_at',)
