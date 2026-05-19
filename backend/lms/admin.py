from django.contrib import admin
from .models import (
    Book, Chapter, Topic, SubTopic, ContentBlock, ContentRevision,
    CurriculumStandard, StandardObjective, TopicStandardAlignment,
    LessonPlan, LessonAttachment,
    Assignment, AssignmentAttachment, AssignmentSubmission,
)


# ---------------------------------------------------------------------------
# Curriculum: Book → Chapter → Topic
# ---------------------------------------------------------------------------

class ChapterInline(admin.TabularInline):
    model = Chapter
    extra = 0
    fields = ['chapter_number', 'title', 'is_active']


class TopicInline(admin.TabularInline):
    model = Topic
    extra = 0
    fields = ['topic_number', 'title', 'estimated_periods', 'is_active']


class SubTopicInline(admin.TabularInline):
    model = SubTopic
    extra = 0
    fields = ['subtopic_number', 'title', 'is_active']


@admin.register(Book)
class BookAdmin(admin.ModelAdmin):
    list_display = ['title', 'school', 'class_obj', 'subject', 'language', 'is_active']
    list_filter = ['language', 'is_active', 'school']
    search_fields = ['title', 'author']
    raw_id_fields = ['school', 'class_obj', 'subject']
    inlines = [ChapterInline]


@admin.register(Chapter)
class ChapterAdmin(admin.ModelAdmin):
    list_display = ['title', 'book', 'chapter_number', 'is_active']
    list_filter = ['is_active']
    search_fields = ['title']
    raw_id_fields = ['book']
    inlines = [TopicInline]


@admin.register(Topic)
class TopicAdmin(admin.ModelAdmin):
    list_display = ['title', 'chapter', 'topic_number', 'estimated_periods', 'is_active']
    list_filter = ['is_active']
    search_fields = ['title']
    raw_id_fields = ['chapter']
    inlines = [SubTopicInline]


@admin.register(SubTopic)
class SubTopicAdmin(admin.ModelAdmin):
    list_display = ['title', 'topic', 'subtopic_number', 'is_active']
    list_filter = ['is_active']
    search_fields = ['title']
    raw_id_fields = ['topic']


@admin.register(ContentBlock)
class ContentBlockAdmin(admin.ModelAdmin):
    list_display = ['block_type', 'chapter', 'topic', 'subtopic', 'sequence_order', 'is_active']
    list_filter = ['block_type', 'is_active']
    search_fields = ['content_text']
    raw_id_fields = ['chapter', 'topic', 'subtopic']


@admin.register(ContentRevision)
class ContentRevisionAdmin(admin.ModelAdmin):
    list_display = ['id', 'content_block', 'changed_by', 'changed_at']
    list_filter = ['changed_at']
    search_fields = ['content_text', 'revision_note']
    raw_id_fields = ['content_block', 'changed_by']
    readonly_fields = ['changed_at']


@admin.register(CurriculumStandard)
class CurriculumStandardAdmin(admin.ModelAdmin):
    list_display = ['name', 'board', 'country']
    list_filter = ['country', 'board']
    search_fields = ['name', 'board']


@admin.register(StandardObjective)
class StandardObjectiveAdmin(admin.ModelAdmin):
    list_display = ['code', 'standard', 'subject', 'grade']
    list_filter = ['standard', 'subject', 'grade']
    search_fields = ['code', 'statement']
    raw_id_fields = ['standard', 'subject', 'grade']


@admin.register(TopicStandardAlignment)
class TopicStandardAlignmentAdmin(admin.ModelAdmin):
    list_display = ['topic', 'objective']
    list_filter = ['objective__standard', 'topic__chapter__book__subject']
    raw_id_fields = ['topic', 'objective']


# ---------------------------------------------------------------------------
# Lesson Plans
# ---------------------------------------------------------------------------

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
