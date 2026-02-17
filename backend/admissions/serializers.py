"""
Simplified admission serializers: enquiries, notes, batch conversion.
"""

from rest_framework import serializers
from .models import AdmissionEnquiry, AdmissionNote


# ── Admission Note ───────────────────────────────────────────

class AdmissionNoteSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source='user.get_full_name', read_only=True)

    class Meta:
        model = AdmissionNote
        fields = ['id', 'enquiry', 'user', 'user_name', 'note', 'note_type', 'created_at']
        read_only_fields = ['id', 'user', 'created_at']


# ── Enquiry List ─────────────────────────────────────────────

class EnquiryListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for list views."""
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    source_display = serializers.CharField(source='get_source_display', read_only=True)

    class Meta:
        model = AdmissionEnquiry
        fields = [
            'id', 'name', 'father_name', 'mobile',
            'applying_for_grade_level',
            'status', 'status_display',
            'source', 'source_display',
            'next_followup_date',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


# ── Enquiry Detail ───────────────────────────────────────────

class EnquiryDetailSerializer(serializers.ModelSerializer):
    """Full serializer for detail/retrieve views."""
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    source_display = serializers.CharField(source='get_source_display', read_only=True)
    school_name = serializers.CharField(source='school.name', read_only=True)
    converted_student_name = serializers.CharField(
        source='converted_student.name', read_only=True, default=None,
    )
    notes_list = AdmissionNoteSerializer(source='activity_notes', many=True, read_only=True)

    class Meta:
        model = AdmissionEnquiry
        fields = [
            'id', 'school', 'school_name',
            'name', 'father_name', 'mobile',
            'applying_for_grade_level',
            'source', 'source_display',
            'next_followup_date', 'notes',
            'status', 'status_display',
            'converted_student', 'converted_student_name',
            'notes_list',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'converted_student', 'created_at', 'updated_at']


# ── Enquiry Create / Update ─────────────────────────────────

class EnquiryCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating / updating enquiries."""

    class Meta:
        model = AdmissionEnquiry
        fields = [
            'id', 'name', 'father_name', 'mobile',
            'applying_for_grade_level',
            'source', 'next_followup_date', 'notes',
        ]
        read_only_fields = ['id']

    def validate(self, attrs):
        if not attrs.get('name'):
            raise serializers.ValidationError({'name': 'Child name is required.'})
        if not attrs.get('father_name'):
            raise serializers.ValidationError({'father_name': 'Father name is required.'})
        if not attrs.get('mobile'):
            raise serializers.ValidationError({'mobile': 'Mobile number is required.'})
        return attrs


# ── Status Update ────────────────────────────────────────────

class EnquiryStatusSerializer(serializers.Serializer):
    """Serializer for status change."""
    status = serializers.ChoiceField(choices=AdmissionEnquiry.STATUS_CHOICES)
    note = serializers.CharField(required=False, allow_blank=True, default='')


# ── Batch Convert ────────────────────────────────────────────

class BatchConvertSerializer(serializers.Serializer):
    """Input serializer for batch converting enquiries to students."""
    enquiry_ids = serializers.ListField(
        child=serializers.IntegerField(),
        min_length=1,
        help_text='List of enquiry IDs to convert.',
    )
    academic_year_id = serializers.IntegerField(help_text='Target academic year.')
    class_id = serializers.IntegerField(help_text='Target class to enrol students into.')
