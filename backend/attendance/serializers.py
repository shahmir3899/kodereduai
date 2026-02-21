"""
Attendance serializers for upload, review, and records.
"""

import logging
from rest_framework import serializers
from .models import AttendanceUpload, AttendanceRecord, AttendanceUploadImage
from students.serializers import StudentSerializer, ClassSerializer

logger = logging.getLogger(__name__)


class AttendanceUploadImageSerializer(serializers.ModelSerializer):
    """
    Serializer for individual upload images/pages.
    """
    class Meta:
        model = AttendanceUploadImage
        fields = [
            'id', 'upload', 'image_url', 'page_number',
            'processing_status', 'error_message',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'processing_status', 'error_message', 'created_at', 'updated_at']


class AttendanceUploadSerializer(serializers.ModelSerializer):
    """
    Serializer for AttendanceUpload - basic info.
    """
    class_name = serializers.CharField(source='class_obj.name', read_only=True)
    school_name = serializers.CharField(source='school.name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)
    academic_year_name = serializers.CharField(source='academic_year.name', read_only=True, default=None)

    class Meta:
        model = AttendanceUpload
        fields = [
            'id', 'school', 'school_name',
            'class_obj', 'class_name', 'date',
            'academic_year', 'academic_year_name',
            'image_url', 'status', 'status_display',
            'confidence_score', 'error_message',
            'created_by', 'created_by_name',
            'confirmed_at', 'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'status', 'confidence_score', 'error_message',
            'confirmed_at', 'created_at', 'updated_at'
        ]


class AttendanceUploadDetailSerializer(serializers.ModelSerializer):
    """
    Detailed serializer for AttendanceUpload - includes AI results.
    """
    class_name = serializers.CharField(source='class_obj.name', read_only=True)
    class_details = ClassSerializer(source='class_obj', read_only=True)
    school_name = serializers.CharField(source='school.name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    created_by_name = serializers.CharField(source='created_by.username', read_only=True)
    confirmed_by_name = serializers.SerializerMethodField()
    matched_students = serializers.SerializerMethodField()
    unmatched_entries = serializers.SerializerMethodField()
    images = AttendanceUploadImageSerializer(many=True, read_only=True)
    all_image_urls = serializers.SerializerMethodField()
    total_pages = serializers.IntegerField(read_only=True)
    academic_year_name = serializers.CharField(source='academic_year.name', read_only=True, default=None)

    class Meta:
        model = AttendanceUpload
        fields = [
            'id', 'school', 'school_name',
            'class_obj', 'class_name', 'class_details', 'date',
            'academic_year', 'academic_year_name',
            'image_url', 'images', 'all_image_urls', 'total_pages',
            'status', 'status_display',
            'ai_output_json', 'ocr_raw_text', 'structured_table_json',
            'confidence_score', 'error_message',
            'matched_students', 'unmatched_entries',
            'created_by', 'created_by_name',
            'confirmed_by', 'confirmed_by_name', 'confirmed_at',
            'created_at', 'updated_at'
        ]

    def get_confirmed_by_name(self, obj):
        return obj.confirmed_by.username if obj.confirmed_by else None

    def get_matched_students(self, obj):
        return obj.get_matched_students()

    def get_unmatched_entries(self, obj):
        return obj.get_unmatched_entries()

    def get_all_image_urls(self, obj):
        return obj.get_all_image_urls()


class AttendanceUploadCreateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating new attendance uploads.

    Supports both single image (legacy) and multiple images (multi-page).
    - image_url: Single image URL (legacy, optional)
    - image_urls: List of image URLs for multi-page registers
    """
    image_urls = serializers.ListField(
        child=serializers.URLField(),
        required=False,
        write_only=True,
        help_text="List of image URLs for multi-page registers"
    )

    class Meta:
        model = AttendanceUpload
        fields = ['id', 'school', 'class_obj', 'date', 'image_url', 'image_urls', 'status']
        read_only_fields = ['id', 'status']
        extra_kwargs = {
            'image_url': {'required': False}  # Make optional since we support image_urls
        }
        # Disable automatic UniqueTogetherValidator - we handle uniqueness manually
        # in validate() to allow replacing non-confirmed uploads
        validators = []

    def validate(self, attrs):
        """Check for duplicate upload for same class/date."""
        logger.info(f"=== VALIDATING ATTENDANCE UPLOAD ===")
        logger.info(f"Attrs received: {attrs}")

        school = attrs.get('school')
        class_obj = attrs.get('class_obj')
        date = attrs.get('date')
        image_url = attrs.get('image_url')
        image_urls = attrs.get('image_urls', [])

        logger.info(f"School: {school} (id: {school.id if school else None})")
        logger.info(f"Class: {class_obj} (id: {class_obj.id if class_obj else None}, school_id: {class_obj.school_id if class_obj else None})")
        logger.info(f"Date: {date}")
        logger.info(f"Image URL: {image_url}")
        logger.info(f"Image URLs: {image_urls}")

        # Validate at least one image is provided
        if not image_url and not image_urls:
            raise serializers.ValidationError({
                'image_url': "Either image_url or image_urls must be provided."
            })

        # Check class belongs to school
        if class_obj.school_id != school.id:
            logger.error(f"Class school mismatch: class.school_id={class_obj.school_id} != school.id={school.id}")
            raise serializers.ValidationError({
                'class_obj': "The selected class does not belong to this school."
            })

        # Check for duplicates - allow replacing failed/pending uploads
        existing = AttendanceUpload.objects.filter(
            school=school,
            class_obj=class_obj,
            date=date
        ).first()

        if existing:
            # Allow replacing if not confirmed
            if existing.status == 'CONFIRMED':
                logger.error(f"Cannot replace confirmed upload: {existing}")
                raise serializers.ValidationError({
                    'date': f"Attendance for {class_obj.name} on {date} has already been confirmed. Cannot replace."
                })
            else:
                # Delete the incomplete/failed upload to allow re-upload
                logger.info(f"Replacing existing upload (status={existing.status}): {existing}")
                existing.delete()

        logger.info("Validation passed!")
        return attrs

    def create(self, validated_data):
        """Create upload with optional multi-page images."""
        image_urls = validated_data.pop('image_urls', [])

        # Create the upload
        upload = AttendanceUpload.objects.create(**validated_data)

        # Create image records for multi-page
        if image_urls:
            for idx, url in enumerate(image_urls, start=1):
                AttendanceUploadImage.objects.create(
                    upload=upload,
                    image_url=url,
                    page_number=idx
                )
            logger.info(f"Created {len(image_urls)} image records for upload {upload.id}")

        return upload


class CorrectionItemSerializer(serializers.Serializer):
    """A single name or roll correction entry."""
    student_id = serializers.IntegerField()
    confirmed = serializers.BooleanField(
        help_text="True = match is correct, False = match was wrong"
    )


class UserChangedMarkSerializer(serializers.Serializer):
    """Implicit feedback: when user changed AI's mark suggestion."""
    student_id = serializers.IntegerField()
    ai_suggested = serializers.CharField()  # 'PRESENT', 'ABSENT', 'LATE', etc.
    user_confirmed = serializers.CharField()  # What user actually marked
    confidence = serializers.FloatField(min_value=0, max_value=1)


class AttendanceConfirmSerializer(serializers.Serializer):
    """
    Serializer for confirming attendance (with optional edits).
    """
    absent_student_ids = serializers.ListField(
        child=serializers.IntegerField(),
        help_text="List of student IDs to mark as absent"
    )
    name_corrections = CorrectionItemSerializer(
        many=True, required=False, default=list,
        help_text="Name match confirmations/rejections"
    )
    roll_corrections = CorrectionItemSerializer(
        many=True, required=False, default=list,
        help_text="Roll number match confirmations/rejections"
    )
    user_changed_marks = UserChangedMarkSerializer(
        many=True, required=False, default=list,
        help_text="Implicit feedback: marks user changed from AI suggestion"
    )

    def validate_absent_student_ids(self, value):
        """Validate all student IDs exist and belong to the correct school/class."""
        from students.models import Student

        upload = self.context.get('upload')
        if not upload:
            return value

        # Get valid student IDs for this class
        valid_ids = set(
            Student.objects.filter(
                school=upload.school,
                class_obj=upload.class_obj,
                is_active=True
            ).values_list('id', flat=True)
        )

        invalid_ids = [sid for sid in value if sid not in valid_ids]
        if invalid_ids:
            raise serializers.ValidationError(
                f"Invalid student IDs: {invalid_ids}. "
                "Students must belong to the same school and class."
            )

        return value


class AttendanceRecordSerializer(serializers.ModelSerializer):
    """
    Serializer for AttendanceRecord.
    """
    student_name = serializers.CharField(source='student.name', read_only=True)
    student_roll = serializers.CharField(source='student.roll_number', read_only=True)
    class_name = serializers.CharField(source='student.class_obj.name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    source_display = serializers.CharField(source='get_source_display', read_only=True)
    academic_year_name = serializers.CharField(source='academic_year.name', read_only=True, default=None)

    class Meta:
        model = AttendanceRecord
        fields = [
            'id', 'school', 'student', 'student_name', 'student_roll',
            'class_name', 'date', 'status', 'status_display',
            'source', 'source_display', 'upload',
            'academic_year', 'academic_year_name',
            'notification_sent', 'notification_sent_at',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class AttendanceBulkEntryItemSerializer(serializers.Serializer):
    """Single student attendance entry."""
    student_id = serializers.IntegerField()
    status = serializers.ChoiceField(choices=['PRESENT', 'ABSENT'])


class AttendanceBulkEntrySerializer(serializers.Serializer):
    """Bulk manual attendance entry for a class on a date."""
    class_id = serializers.IntegerField(
        help_text="ID of the class to mark attendance for"
    )
    date = serializers.DateField(
        help_text="Date of attendance (YYYY-MM-DD)"
    )
    entries = serializers.ListField(
        child=AttendanceBulkEntryItemSerializer(),
        help_text="List of {student_id, status} entries",
    )


class DailyAbsentReportSerializer(serializers.Serializer):
    """
    Serializer for daily absent report.
    """
    date = serializers.DateField()
    total_students = serializers.IntegerField()
    absent_count = serializers.IntegerField()
    present_count = serializers.IntegerField()
    absent_students = AttendanceRecordSerializer(many=True)


class ChronicAbsenteeSerializer(serializers.Serializer):
    """
    Serializer for chronic absentee report.
    """
    student = StudentSerializer()
    absent_count = serializers.IntegerField()
    total_days = serializers.IntegerField()
    absence_percentage = serializers.FloatField()


class AttendanceAnomalySerializer(serializers.ModelSerializer):
    class_name = serializers.CharField(source='class_obj.name', read_only=True, default=None)
    student_name = serializers.CharField(source='student.name', read_only=True, default=None)
    resolved_by_name = serializers.CharField(source='resolved_by.get_full_name', read_only=True, default=None)

    class Meta:
        from .models import AttendanceAnomaly
        model = AttendanceAnomaly
        fields = [
            'id', 'anomaly_type', 'severity', 'date',
            'class_obj', 'class_name', 'student', 'student_name',
            'description', 'details',
            'is_resolved', 'resolved_by', 'resolved_by_name',
            'resolved_at', 'resolution_notes', 'created_at',
        ]
        read_only_fields = ['id', 'anomaly_type', 'severity', 'date', 'description',
                            'details', 'created_at', 'resolved_by', 'resolved_at']
