from django.contrib import admin
from .models import (
    ExamType, ExamGroup, Exam, ExamSubject, StudentMark, GradeScale,
    Question, ExamPaper, PaperQuestion, PaperUpload, PaperFeedback
)


@admin.register(ExamType)
class ExamTypeAdmin(admin.ModelAdmin):
    list_display = ('name', 'school', 'weight', 'is_active')
    list_filter = ('school', 'is_active')


@admin.register(ExamGroup)
class ExamGroupAdmin(admin.ModelAdmin):
    list_display = ('name', 'school', 'academic_year', 'exam_type', 'start_date', 'end_date', 'is_active')
    list_filter = ('school', 'academic_year', 'is_active')
    search_fields = ('name',)


@admin.register(Exam)
class ExamAdmin(admin.ModelAdmin):
    list_display = ('name', 'school', 'academic_year', 'exam_type', 'class_obj', 'exam_group', 'status')
    list_filter = ('school', 'academic_year', 'status')
    search_fields = ('name',)


@admin.register(ExamSubject)
class ExamSubjectAdmin(admin.ModelAdmin):
    list_display = ('exam', 'subject', 'total_marks', 'passing_marks')
    list_filter = ('school', 'exam')


@admin.register(StudentMark)
class StudentMarkAdmin(admin.ModelAdmin):
    list_display = ('student', 'exam_subject', 'marks_obtained', 'is_absent')
    list_filter = ('school', 'exam_subject__exam')
    search_fields = ('student__name',)


@admin.register(GradeScale)
class GradeScaleAdmin(admin.ModelAdmin):
    list_display = ('grade_label', 'school', 'min_percentage', 'max_percentage', 'gpa_points')
    list_filter = ('school',)


# ===========================================
# Question Paper Builder Admin
# ===========================================


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ('id', 'subject', 'question_type', 'difficulty_level', 'marks', 'created_by', 'is_active')
    list_filter = ('school', 'subject', 'question_type', 'difficulty_level', 'is_active')
    search_fields = ('question_text',)
    readonly_fields = ('created_at', 'updated_at')


class PaperQuestionInline(admin.TabularInline):
    model = PaperQuestion
    extra = 0
    fields = ('question', 'question_order', 'marks_override')
    ordering = ['question_order']


@admin.register(ExamPaper)
class ExamPaperAdmin(admin.ModelAdmin):
    list_display = ('paper_title', 'school', 'class_obj', 'subject', 'total_marks', 'status', 'generated_by')
    list_filter = ('school', 'class_obj', 'subject', 'status')
    search_fields = ('paper_title',)
    readonly_fields = ('created_at', 'updated_at', 'question_count', 'calculated_total_marks')
    inlines = [PaperQuestionInline]


@admin.register(PaperUpload)
class PaperUploadAdmin(admin.ModelAdmin):
    list_display = ('id', 'school', 'uploaded_by', 'status', 'extraction_confidence', 'created_at')
    list_filter = ('school', 'status', 'created_at')
    readonly_fields = ('created_at', 'processed_at', 'ai_extracted_json', 'extraction_confidence')
    search_fields = ('id',)


@admin.register(PaperFeedback)
class PaperFeedbackAdmin(admin.ModelAdmin):
    list_display = ('id', 'paper_upload', 'confirmed_by', 'created_at')
    list_filter = ('created_at',)
    readonly_fields = ('created_at', 'ai_extracted_json', 'user_confirmed_json', 'accuracy_metrics')
