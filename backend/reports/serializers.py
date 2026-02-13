"""
Report serializers.
"""

from rest_framework import serializers
from .models import GeneratedReport


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
