from django.contrib import admin
from .models import AdmissionEnquiry, AdmissionNote


@admin.register(AdmissionEnquiry)
class AdmissionEnquiryAdmin(admin.ModelAdmin):
    list_display = ('name', 'father_name', 'mobile', 'applying_for_grade_level', 'status', 'source', 'next_followup_date', 'created_at')
    list_filter = ('status', 'source', 'school', 'created_at')
    search_fields = ('name', 'father_name', 'mobile')
    readonly_fields = ('created_at', 'updated_at')
    fieldsets = (
        ('Enquiry Details', {
            'fields': ('school', 'name', 'father_name', 'mobile', 'applying_for_grade_level')
        }),
        ('Tracking', {
            'fields': ('source', 'next_followup_date', 'notes', 'status')
        }),
        ('Conversion', {
            'fields': ('converted_student',)
        }),
        ('Timestamps', {
            'fields': ('created_at', 'updated_at')
        }),
    )


@admin.register(AdmissionNote)
class AdmissionNoteAdmin(admin.ModelAdmin):
    list_display = ('get_enquiry', 'note_type', 'user', 'created_at')
    list_filter = ('note_type', 'created_at', 'user')
    search_fields = ('enquiry__name', 'note')
    readonly_fields = ('created_at',)

    def get_enquiry(self, obj):
        return f"{obj.enquiry.name} ({obj.enquiry.id})"
    get_enquiry.short_description = 'Enquiry'
