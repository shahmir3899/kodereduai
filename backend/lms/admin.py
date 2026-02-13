from django.contrib import admin
from .models import (
    LessonPlan, LessonAttachment,
    Assignment, AssignmentAttachment, AssignmentSubmission,
)


class LessonAttachmentInline(admin.TabularInline):
    model = LessonAttachment
    extra = 0


@admin.register(LessonPlan)
class LessonPlanAdmin(admin.ModelAdmin):
    list_display = [
        'title', 'school', 'class_obj', 'subject',
        'teacher', 'lesson_date', 'status', 'is_active',
    ]
    list_filter = ['status', 'is_active', 'school', 'lesson_date']
    search_fields = ['title', 'description']
    raw_id_fields = ['school', 'academic_year', 'class_obj', 'subject', 'teacher']
    inlines = [LessonAttachmentInline]


@admin.register(LessonAttachment)
class LessonAttachmentAdmin(admin.ModelAdmin):
    list_display = ['file_name', 'lesson', 'attachment_type', 'uploaded_at']
    list_filter = ['attachment_type']
    search_fields = ['file_name']
    raw_id_fields = ['lesson']


class AssignmentAttachmentInline(admin.TabularInline):
    model = AssignmentAttachment
    extra = 0


@admin.register(Assignment)
class AssignmentAdmin(admin.ModelAdmin):
    list_display = [
        'title', 'school', 'class_obj', 'subject',
        'teacher', 'assignment_type', 'due_date', 'status', 'is_active',
    ]
    list_filter = ['status', 'assignment_type', 'is_active', 'school']
    search_fields = ['title', 'description']
    raw_id_fields = ['school', 'academic_year', 'class_obj', 'subject', 'teacher']
    inlines = [AssignmentAttachmentInline]


@admin.register(AssignmentAttachment)
class AssignmentAttachmentAdmin(admin.ModelAdmin):
    list_display = ['file_name', 'assignment', 'attachment_type', 'uploaded_at']
    list_filter = ['attachment_type']
    search_fields = ['file_name']
    raw_id_fields = ['assignment']


@admin.register(AssignmentSubmission)
class AssignmentSubmissionAdmin(admin.ModelAdmin):
    list_display = [
        'student', 'assignment', 'school', 'status',
        'marks_obtained', 'submitted_at', 'graded_at',
    ]
    list_filter = ['status', 'school']
    search_fields = ['student__name', 'assignment__title']
    raw_id_fields = ['assignment', 'student', 'school', 'graded_by']
    readonly_fields = ['submitted_at']
