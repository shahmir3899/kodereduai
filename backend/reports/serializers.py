"""
Report serializers.
"""

from rest_framework import serializers
from .models import GeneratedReport, CustomLetter


class GeneratedReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = GeneratedReport
        fields = [
            'id', 'school', 'report_type', 'title', 'parameters',
            'file_url', 'format', 'generated_by', 'created_at',
        ]
        read_only_fields = fields


class GenerateReportSerializer(serializers.Serializer):
    """Input serializer for report generation."""
    report_type = serializers.ChoiceField(choices=GeneratedReport.REPORT_TYPE_CHOICES)
    format = serializers.ChoiceField(choices=[('PDF', 'PDF'), ('XLSX', 'Excel')], default='PDF')
    parameters = serializers.DictField(required=False, default=dict)


class CustomLetterSerializer(serializers.ModelSerializer):
    """Serializer for custom letter CRUD."""
    template_display = serializers.CharField(source='get_template_type_display', read_only=True)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = CustomLetter
        fields = [
            'id', 'recipient', 'subject', 'body_text', 'line_spacing',
            'template_type', 'template_display', 'created_by', 'created_by_name',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_by', 'created_by_name', 'created_at', 'updated_at', 'template_display']

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return 'Unknown'


class GenerateLetterPDFSerializer(serializers.Serializer):
    """Input serializer for letter PDF generation."""
    letter_id = serializers.IntegerField(required=False, help_text='Generate from saved letter')
    recipient = serializers.CharField(required=False, max_length=500)
    subject = serializers.CharField(required=False, max_length=200)
    body_text = serializers.CharField(required=False)
    line_spacing = serializers.ChoiceField(
        choices=CustomLetter.LINE_SPACING_CHOICES, default='single', required=False,
    )

    def validate(self, data):
        if not data.get('letter_id') and not (data.get('recipient') and data.get('subject') and data.get('body_text')):
            raise serializers.ValidationError(
                'Provide either letter_id or all of: recipient, subject, body_text'
            )
        return data


class TemplatePrefillSerializer(serializers.Serializer):
    """Input for prefilling a template with employee data."""
    template_body = serializers.CharField()
    employee_id = serializers.IntegerField()
