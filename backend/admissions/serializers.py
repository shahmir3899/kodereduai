"""
Admission serializers for sessions, enquiries, documents, notes, and analytics.
"""

from rest_framework import serializers
from .models import AdmissionSession, AdmissionEnquiry, AdmissionDocument, AdmissionNote


# ── Admission Session ────────────────────────────────────────

class GradeMinimalSerializer(serializers.Serializer):
    """Lightweight read-only representation of a Grade for nested display."""
    id = serializers.IntegerField()
    name = serializers.CharField()


class AdmissionSessionSerializer(serializers.ModelSerializer):
    grades_open_detail = GradeMinimalSerializer(
        source='grades_open', many=True, read_only=True,
    )
    school_name = serializers.CharField(source='school.name', read_only=True)

    class Meta:
        model = AdmissionSession
        fields = [
            'id', 'school', 'school_name', 'academic_year', 'name',
            'start_date', 'end_date', 'grades_open', 'grades_open_detail',
            'is_active', 'form_fields', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'created_at', 'updated_at']

    def validate(self, attrs):
        start = attrs.get('start_date', getattr(self.instance, 'start_date', None))
        end = attrs.get('end_date', getattr(self.instance, 'end_date', None))
        if start and end and start > end:
            raise serializers.ValidationError({
                'end_date': 'End date must be on or after start date.',
            })
        return attrs


# ── Admission Document ───────────────────────────────────────

class AdmissionDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = AdmissionDocument
        fields = [
            'id', 'enquiry', 'document_type', 'file_url',
            'file_name', 'uploaded_at',
        ]
        read_only_fields = ['id', 'uploaded_at']


# ── Admission Note ───────────────────────────────────────────

class AdmissionNoteSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source='user.get_full_name', read_only=True)

    class Meta:
        model = AdmissionNote
        fields = [
            'id', 'enquiry', 'user', 'user_name', 'note',
            'note_type', 'created_at',
        ]
        read_only_fields = ['id', 'user', 'created_at']


# ── Admission Enquiry ────────────────────────────────────────

class AdmissionEnquiryListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for list views."""
    assigned_to_name = serializers.CharField(
        source='assigned_to.get_full_name', read_only=True, default=None,
    )
    grade_name = serializers.CharField(
        source='applying_for_grade.name', read_only=True, default=None,
    )
    stage_display = serializers.CharField(
        source='get_stage_display', read_only=True,
    )
    source_display = serializers.CharField(
        source='get_source_display', read_only=True,
    )

    class Meta:
        model = AdmissionEnquiry
        fields = [
            'id', 'child_name', 'parent_name', 'parent_phone',
            'applying_for_grade', 'grade_name',
            'stage', 'stage_display',
            'source', 'source_display',
            'priority', 'assigned_to', 'assigned_to_name',
            'next_followup_date', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class AdmissionEnquiryDetailSerializer(serializers.ModelSerializer):
    """Full serializer for detail/retrieve views."""
    assigned_to_name = serializers.CharField(
        source='assigned_to.get_full_name', read_only=True, default=None,
    )
    grade_name = serializers.CharField(
        source='applying_for_grade.name', read_only=True, default=None,
    )
    stage_display = serializers.CharField(
        source='get_stage_display', read_only=True,
    )
    source_display = serializers.CharField(
        source='get_source_display', read_only=True,
    )
    school_name = serializers.CharField(
        source='school.name', read_only=True,
    )
    session_name = serializers.CharField(
        source='session.name', read_only=True, default=None,
    )
    documents = AdmissionDocumentSerializer(many=True, read_only=True)
    notes_count = serializers.IntegerField(read_only=True, default=0)
    converted_student_name = serializers.CharField(
        source='converted_student.name', read_only=True, default=None,
    )

    class Meta:
        model = AdmissionEnquiry
        fields = [
            'id', 'school', 'school_name',
            'session', 'session_name',
            # Child info
            'child_name', 'child_dob', 'child_gender',
            'applying_for_grade', 'grade_name', 'previous_school',
            # Parent info
            'parent_name', 'parent_phone', 'parent_email',
            'parent_occupation', 'address',
            # Lead tracking
            'source', 'source_display', 'referral_details',
            # Pipeline
            'stage', 'stage_display',
            # Assignment
            'assigned_to', 'assigned_to_name',
            'priority', 'next_followup_date', 'notes', 'metadata',
            # Conversion
            'converted_student', 'converted_student_name',
            # Nested
            'documents', 'notes_count',
            # Timestamps
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'school', 'converted_student', 'created_at', 'updated_at',
        ]


class AdmissionEnquiryCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating / updating enquiries."""

    class Meta:
        model = AdmissionEnquiry
        fields = [
            'session',
            # Child info
            'child_name', 'child_dob', 'child_gender',
            'applying_for_grade', 'previous_school',
            # Parent info
            'parent_name', 'parent_phone', 'parent_email',
            'parent_occupation', 'address',
            # Lead tracking
            'source', 'referral_details',
            # Pipeline
            'stage',
            # Assignment
            'assigned_to', 'priority', 'next_followup_date',
            'notes', 'metadata',
        ]

    def validate(self, attrs):
        if not attrs.get('child_name'):
            raise serializers.ValidationError({
                'child_name': 'Child name is required.',
            })
        if not attrs.get('parent_name'):
            raise serializers.ValidationError({
                'parent_name': 'Parent name is required.',
            })
        if not attrs.get('parent_phone'):
            raise serializers.ValidationError({
                'parent_phone': 'Parent phone is required.',
            })
        return attrs


class AdmissionEnquiryStageSerializer(serializers.Serializer):
    """Serializer for stage transition actions."""
    stage = serializers.ChoiceField(choices=AdmissionEnquiry.STAGE_CHOICES)
    note = serializers.CharField(required=False, allow_blank=True, default='')

    def update(self, instance, validated_data):
        old_stage = instance.get_stage_display()
        new_stage_code = validated_data['stage']
        instance.stage = new_stage_code
        instance.save(update_fields=['stage', 'updated_at'])

        new_stage = instance.get_stage_display()

        # Auto-create a STATUS_CHANGE note
        note_text = validated_data.get('note', '')
        log_message = f"Stage changed from {old_stage} to {new_stage}"
        if note_text:
            log_message += f": {note_text}"

        AdmissionNote.objects.create(
            enquiry=instance,
            user=self.context['request'].user,
            note=log_message,
            note_type='STATUS_CHANGE',
        )

        return instance


class AdmissionEnquiryConvertSerializer(serializers.Serializer):
    """Input serializer for converting an enquiry to a Student record."""
    class_id = serializers.IntegerField(help_text='Class to enrol the student into.')
    roll_number = serializers.CharField(max_length=20)


# ── Admission Analytics ──────────────────────────────────────

class AdmissionAnalyticsSerializer(serializers.Serializer):
    """Read-only serializer for pipeline analytics."""
    total_enquiries = serializers.IntegerField()
    pipeline_funnel = serializers.ListField(child=serializers.DictField())
    source_breakdown = serializers.ListField(child=serializers.DictField())
    conversion_rate = serializers.FloatField()
    monthly_trend = serializers.ListField(child=serializers.DictField())
