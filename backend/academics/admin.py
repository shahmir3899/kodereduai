from django.contrib import admin
from .models import Subject, ClassSubject, TimetableSlot, TimetableEntry


@admin.register(Subject)
class SubjectAdmin(admin.ModelAdmin):
    list_display = ['name', 'code', 'is_elective', 'school', 'is_active']
    list_filter = ['school', 'is_elective', 'is_active']
    search_fields = ['name', 'code']


@admin.register(ClassSubject)
class ClassSubjectAdmin(admin.ModelAdmin):
    list_display = ['class_obj', 'subject', 'teacher', 'periods_per_week', 'school']
    list_filter = ['school', 'class_obj']
    raw_id_fields = ['class_obj', 'subject', 'teacher']


@admin.register(TimetableSlot)
class TimetableSlotAdmin(admin.ModelAdmin):
    list_display = ['name', 'slot_type', 'start_time', 'end_time', 'order', 'school']
    list_filter = ['school', 'slot_type']
    ordering = ['school', 'order']


@admin.register(TimetableEntry)
class TimetableEntryAdmin(admin.ModelAdmin):
    list_display = ['class_obj', 'day', 'slot', 'subject', 'teacher', 'school']
    list_filter = ['school', 'class_obj', 'day']
    raw_id_fields = ['class_obj', 'slot', 'subject', 'teacher']
