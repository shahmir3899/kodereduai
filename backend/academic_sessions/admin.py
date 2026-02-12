from django.contrib import admin
from .models import AcademicYear, Term, StudentEnrollment


@admin.register(AcademicYear)
class AcademicYearAdmin(admin.ModelAdmin):
    list_display = ('name', 'school', 'start_date', 'end_date', 'is_current', 'is_active')
    list_filter = ('school', 'is_current', 'is_active')
    search_fields = ('name',)


@admin.register(Term)
class TermAdmin(admin.ModelAdmin):
    list_display = ('name', 'academic_year', 'school', 'term_type', 'order', 'start_date', 'end_date', 'is_current')
    list_filter = ('school', 'academic_year', 'term_type')


@admin.register(StudentEnrollment)
class StudentEnrollmentAdmin(admin.ModelAdmin):
    list_display = ('student', 'class_obj', 'academic_year', 'roll_number', 'status')
    list_filter = ('school', 'academic_year', 'status')
    search_fields = ('student__name', 'roll_number')
