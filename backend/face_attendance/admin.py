from django.contrib import admin

from .models import FaceAttendanceSession, StudentFaceEmbedding, FaceDetectionResult


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
