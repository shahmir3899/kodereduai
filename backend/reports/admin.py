from django.contrib import admin
from .models import GeneratedReport


@admin.register(GeneratedReport)
class GeneratedReportAdmin(admin.ModelAdmin):
    list_display = ['title', 'report_type', 'format', 'school', 'generated_by', 'created_at']
    list_filter = ['report_type', 'format']
    readonly_fields = ['created_at']
