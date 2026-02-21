"""
Notification serializers.
"""

from rest_framework import serializers
from .models import (
    NotificationTemplate,
    NotificationLog,
    NotificationPreference,
    SchoolNotificationConfig,
)


class NotificationTemplateSerializer(serializers.ModelSerializer):
    school_name = serializers.CharField(source='school.name', read_only=True, default=None)

    class Meta:
        model = NotificationTemplate
        fields = [
            'id', 'school', 'school_name', 'name', 'event_type', 'channel',
            'subject_template', 'body_template', 'is_active',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class NotificationLogSerializer(serializers.ModelSerializer):
    channel_display = serializers.CharField(source='get_channel_display', read_only=True)
    event_type_display = serializers.CharField(source='get_event_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    student_name = serializers.CharField(source='student.name', read_only=True, default=None)

    class Meta:
        model = NotificationLog
        fields = [
            'id', 'school', 'template', 'channel', 'channel_display',
            'event_type', 'event_type_display',
            'recipient_type', 'recipient_identifier', 'recipient_user',
            'student', 'student_name',
            'title', 'body', 'status', 'status_display', 'metadata',
            'sent_at', 'delivered_at', 'read_at', 'created_at',
        ]
        read_only_fields = fields


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationPreference
        fields = [
            'id', 'school', 'user', 'student', 'channel', 'event_type',
            'is_enabled', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class SchoolNotificationConfigSerializer(serializers.ModelSerializer):
    school_name = serializers.CharField(source='school.name', read_only=True)

    class Meta:
        model = SchoolNotificationConfig
        fields = [
            'id', 'school', 'school_name',
            'whatsapp_enabled', 'sms_enabled', 'in_app_enabled', 'email_enabled',
            'push_enabled', 'quiet_hours_start', 'quiet_hours_end',
            'fee_reminder_day', 'daily_absence_summary_time',
            'smart_scheduling_enabled',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class SendNotificationSerializer(serializers.Serializer):
    """Serializer for manually sending a notification."""
    event_type = serializers.ChoiceField(choices=NotificationTemplate.EVENT_TYPE_CHOICES)
    channel = serializers.ChoiceField(choices=NotificationTemplate.CHANNEL_CHOICES)
    recipient_identifier = serializers.CharField(max_length=200)
    recipient_type = serializers.ChoiceField(
        choices=NotificationLog.RECIPIENT_TYPE_CHOICES,
        default='PARENT',
    )
    title = serializers.CharField(max_length=200, required=False, default='')
    body = serializers.CharField(required=False, default='')
    context = serializers.DictField(required=False, default=dict)
    student_id = serializers.IntegerField(required=False, allow_null=True)
