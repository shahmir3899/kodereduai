from django.contrib import admin
from .models import ExamType, ExamGroup, Exam, ExamSubject, StudentMark, GradeScale


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
