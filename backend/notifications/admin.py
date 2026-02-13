from django.contrib import admin
from .models import (
    NotificationTemplate,
    NotificationLog,
    NotificationPreference,
    SchoolNotificationConfig,
)


@admin.register(NotificationTemplate)
class NotificationTemplateAdmin(admin.ModelAdmin):
    list_display = ['name', 'event_type', 'channel', 'school', 'is_active']
    list_filter = ['event_type', 'channel', 'is_active']
    search_fields = ['name']


@admin.register(NotificationLog)
class NotificationLogAdmin(admin.ModelAdmin):
    list_display = ['channel', 'event_type', 'recipient_identifier', 'status', 'created_at']
    list_filter = ['channel', 'event_type', 'status']
    search_fields = ['recipient_identifier', 'title']
    readonly_fields = ['created_at']


@admin.register(NotificationPreference)
class NotificationPreferenceAdmin(admin.ModelAdmin):
    list_display = ['school', 'user', 'student', 'channel', 'event_type', 'is_enabled']
    list_filter = ['channel', 'event_type', 'is_enabled']


@admin.register(SchoolNotificationConfig)
class SchoolNotificationConfigAdmin(admin.ModelAdmin):
    list_display = ['school', 'whatsapp_enabled', 'sms_enabled', 'in_app_enabled']
