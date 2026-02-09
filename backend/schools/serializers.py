"""
School serializers for tenant management.
"""

from rest_framework import serializers
from .models import School


class SchoolSerializer(serializers.ModelSerializer):
    """
    Serializer for School model.
    """
    user_count = serializers.SerializerMethodField()
    student_count = serializers.SerializerMethodField()

    class Meta:
        model = School
        fields = [
            'id', 'name', 'subdomain', 'logo',
            'address', 'contact_email', 'contact_phone',
            'whatsapp_sender_id', 'enabled_modules',
            'mark_mappings', 'register_config',
            'is_active', 'user_count', 'student_count',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_user_count(self, obj):
        return obj.users.count()

    def get_student_count(self, obj):
        return obj.students.filter(is_active=True).count()


class MarkMappingsSerializer(serializers.Serializer):
    """
    Serializer for updating school mark mappings.
    """
    PRESENT = serializers.ListField(
        child=serializers.CharField(max_length=5),
        required=False,
        help_text="Symbols that indicate PRESENT"
    )
    ABSENT = serializers.ListField(
        child=serializers.CharField(max_length=5),
        required=False,
        help_text="Symbols that indicate ABSENT"
    )
    LATE = serializers.ListField(
        child=serializers.CharField(max_length=5),
        required=False,
        help_text="Symbols that indicate LATE"
    )
    LEAVE = serializers.ListField(
        child=serializers.CharField(max_length=5),
        required=False,
        help_text="Symbols that indicate LEAVE"
    )
    default = serializers.ChoiceField(
        choices=['PRESENT', 'ABSENT', 'LATE', 'LEAVE'],
        default='ABSENT',
        help_text="Default status for unrecognized marks"
    )

    def validate(self, data):
        """Ensure at least PRESENT and ABSENT are defined."""
        if not data.get('PRESENT') and not data.get('ABSENT'):
            raise serializers.ValidationError(
                "At least PRESENT or ABSENT symbols must be defined."
            )
        return data


class RegisterConfigSerializer(serializers.Serializer):
    """
    Serializer for updating school register configuration.
    """
    orientation = serializers.ChoiceField(
        choices=['rows_are_students', 'columns_are_students'],
        default='rows_are_students'
    )
    date_header_row = serializers.IntegerField(min_value=0, default=0)
    student_name_col = serializers.IntegerField(min_value=0, default=0)
    roll_number_col = serializers.IntegerField(min_value=-1, default=1)
    data_start_row = serializers.IntegerField(min_value=0, default=1)
    data_start_col = serializers.IntegerField(min_value=0, default=2)


class SchoolCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating new schools.
    """
    class Meta:
        model = School
        fields = [
            'name', 'subdomain', 'logo',
            'address', 'contact_email', 'contact_phone',
            'whatsapp_sender_id', 'enabled_modules'
        ]

    def validate_subdomain(self, value):
        """Ensure subdomain is lowercase and alphanumeric."""
        value = value.lower().strip()
        if not value.replace('-', '').isalnum():
            raise serializers.ValidationError(
                "Subdomain can only contain letters, numbers, and hyphens."
            )
        if value in ['www', 'api', 'admin', 'app', 'dashboard']:
            raise serializers.ValidationError(
                "This subdomain is reserved."
            )
        return value


class SchoolStatsSerializer(serializers.Serializer):
    """
    Serializer for school statistics.
    """
    total_students = serializers.IntegerField()
    total_classes = serializers.IntegerField()
    total_users = serializers.IntegerField()
    total_uploads = serializers.IntegerField()
    uploads_this_month = serializers.IntegerField()
    confirmed_uploads = serializers.IntegerField()
    failed_uploads = serializers.IntegerField()
    pending_reviews = serializers.IntegerField()
