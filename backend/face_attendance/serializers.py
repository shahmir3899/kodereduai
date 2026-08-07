"""
Serializers for face attendance models.
"""

import numpy as np
from rest_framework import serializers

from students.models import Student, Class
from .models import (
    FaceAttendanceSession, StudentFaceEmbedding, FaceDetectionResult,
    FaceCaptureDevice, FaceLiveDetectionEvent,
)


class StudentMinimalSerializer(serializers.ModelSerializer):
    """Minimal student info for face attendance responses."""

    class Meta:
        model = Student
        fields = ['id', 'name', 'roll_number']


class FaceDetectionResultSerializer(serializers.ModelSerializer):
    """Serializer for individual face detection results."""

    matched_student = StudentMinimalSerializer(read_only=True)

    class Meta:
        model = FaceDetectionResult
        fields = [
            'id', 'face_index', 'bounding_box', 'face_crop_url',
            'quality_score', 'matched_student', 'confidence',
            'match_status', 'match_distance', 'alternative_matches',
        ]
        read_only_fields = fields


class ClassMinimalSerializer(serializers.ModelSerializer):
    """Minimal class info."""

    class Meta:
        model = Class
        fields = ['id', 'name', 'section']


class FaceAttendanceSessionListSerializer(serializers.ModelSerializer):
    """Serializer for listing sessions."""

    class_obj = ClassMinimalSerializer(read_only=True)
    created_by_name = serializers.CharField(source='created_by.get_full_name', read_only=True)

    class Meta:
        model = FaceAttendanceSession
        fields = [
            'id', 'class_obj', 'date', 'status', 'image_url',
            'total_faces_detected', 'faces_matched', 'faces_flagged',
            'faces_ignored', 'created_by_name', 'created_at',
        ]
        read_only_fields = fields


class ClassStudentWithEmbeddingSerializer(serializers.ModelSerializer):
    """Student info with face enrollment status."""

    has_embedding = serializers.SerializerMethodField()
    matched = serializers.SerializerMethodField()

    class Meta:
        model = Student
        fields = ['id', 'name', 'roll_number', 'has_embedding', 'matched']

    def __init__(self, *args, **kwargs):
        self.matched_student_ids = kwargs.pop('matched_student_ids', set())
        super().__init__(*args, **kwargs)

    def get_has_embedding(self, obj):
        return StudentFaceEmbedding.objects.filter(
            student=obj, is_active=True
        ).exists()

    def get_matched(self, obj):
        return obj.id in self.matched_student_ids


class FaceAttendanceSessionDetailSerializer(serializers.ModelSerializer):
    """Detailed session with all detections and class student list."""

    class_obj = ClassMinimalSerializer(read_only=True)
    detections = FaceDetectionResultSerializer(many=True, read_only=True)
    class_students = serializers.SerializerMethodField()
    created_by_name = serializers.CharField(source='created_by.get_full_name', read_only=True)

    class Meta:
        model = FaceAttendanceSession
        fields = [
            'id', 'class_obj', 'date', 'status', 'image_url',
            'total_faces_detected', 'faces_matched', 'faces_flagged',
            'faces_ignored', 'thresholds_used', 'error_message',
            'detections', 'class_students',
            'created_by_name', 'confirmed_by', 'confirmed_at',
            'created_at', 'updated_at',
        ]
        read_only_fields = fields

    def get_class_students(self, obj):
        matched_ids = set(
            obj.detections.exclude(matched_student=None)
            .values_list('matched_student_id', flat=True)
        )
        students = Student.objects.filter(
            class_obj=obj.class_obj, is_active=True
        ).order_by('roll_number', 'name')
        return ClassStudentWithEmbeddingSerializer(
            students, many=True, matched_student_ids=matched_ids
        ).data


class FaceAttendanceSessionCreateSerializer(serializers.Serializer):
    """Create a new face attendance session (triggers processing)."""

    class_obj = serializers.PrimaryKeyRelatedField(queryset=Class.objects.all())
    date = serializers.DateField()
    image_url = serializers.URLField(max_length=500)

    def validate_class_obj(self, value):
        request = self.context.get('request')
        if request:
            from core.mixins import ensure_tenant_school_id
            school_id = ensure_tenant_school_id(request)
            if school_id and value.school_id != school_id:
                raise serializers.ValidationError('Class does not belong to your school.')
        return value


class FaceAttendanceConfirmSerializer(serializers.Serializer):
    """Confirm face attendance session and create records."""

    present_student_ids = serializers.ListField(
        child=serializers.IntegerField(),
        help_text='List of student IDs confirmed as present',
    )
    removed_detection_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        default=list,
        help_text='Detection IDs that the teacher removed',
    )
    manual_additions = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        default=list,
        help_text='Student IDs manually added as present',
    )
    corrections = serializers.ListField(
        child=serializers.DictField(),
        required=False,
        default=list,
        help_text='[{"detection_face_index": 1, "correct_student_id": 22}]',
    )

    def validate_present_student_ids(self, value):
        session = self.context.get('session')
        if session:
            class_student_ids = set(
                Student.objects.filter(
                    class_obj=session.class_obj, is_active=True
                ).values_list('id', flat=True)
            )
            invalid = set(value) - class_student_ids
            if invalid:
                raise serializers.ValidationError(
                    f'Students {invalid} do not belong to this class.'
                )
        return value


class StudentFaceEmbeddingSerializer(serializers.ModelSerializer):
    """Serializer for face enrollment records."""

    student_name = serializers.CharField(source='student.name', read_only=True)
    student_roll = serializers.CharField(source='student.roll_number', read_only=True)
    class_name = serializers.CharField(source='student.class_obj.name', read_only=True)

    class Meta:
        model = StudentFaceEmbedding
        fields = [
            'id', 'student', 'student_name', 'student_roll', 'class_name',
            'source_image_url', 'quality_score', 'embedding_version',
            'is_active', 'created_at',
        ]
        read_only_fields = [
            'id', 'student_name', 'student_roll', 'class_name',
            'quality_score', 'embedding_version', 'created_at',
        ]


class FaceEnrollSerializer(serializers.Serializer):
    """Enroll a student's face from an uploaded photo (legacy dlib/Celery path)."""

    student_id = serializers.PrimaryKeyRelatedField(queryset=Student.objects.all())
    image_url = serializers.URLField(max_length=500)
    override_duplicate = serializers.BooleanField(
        required=False, default=False,
        help_text='Skip the duplicate-enrollment check — admin has confirmed this is a different person.',
    )


class FaceEnrollWithEmbeddingSerializer(serializers.Serializer):
    """
    Enroll a student's face from a vector already extracted client-side
    (Live Mobile guided capture — face-api.js, design doc §5). Synchronous,
    no Celery dispatch: there's no server-side detection work left once the
    browser already produced the embedding.
    """

    student_id = serializers.PrimaryKeyRelatedField(queryset=Student.objects.all())
    embedding = serializers.ListField(
        child=serializers.FloatField(),
        min_length=128,
        max_length=128,
        help_text='128-d face embedding vector, already extracted client-side',
    )
    embedding_version = serializers.CharField(max_length=20)
    quality_score = serializers.FloatField(required=False, default=0.0, min_value=0.0, max_value=1.0)
    override_duplicate = serializers.BooleanField(
        required=False, default=False,
        help_text='Skip the duplicate-enrollment check — admin has confirmed this is a different person.',
    )


class LiveMatchRequestSerializer(serializers.Serializer):
    """
    Shared Live Mobile / Fixed Camera live-match ingest payload. The
    embedding is already extracted client-side or on-prem — no image ever
    reaches this endpoint.
    """

    embedding = serializers.ListField(
        child=serializers.FloatField(),
        min_length=128,
        max_length=128,
        help_text='128-d face embedding vector, already extracted on-prem',
    )
    embedding_version = serializers.CharField(max_length=20)
    timestamp = serializers.DateTimeField(help_text='Capture-side clock (device/browser)')
    class_id = serializers.IntegerField(
        required=False, allow_null=True,
        help_text='Optional — validated against CLASS-scoped devices, ignored for SCHOOL-scoped ones',
    )


class FaceCaptureDeviceSerializer(serializers.ModelSerializer):
    """
    Read + limited edit only — no create/delete here. Devices are
    provisioned via Django admin (design doc §9.4: no self-service pairing
    yet), which is also the only place the raw API key is ever shown.
    is_active/scope_type/class_obj/name are the only editable fields;
    the online/offline read is left to the frontend to derive from
    last_seen_at so it can stay live between refetches.
    """

    class_obj = serializers.PrimaryKeyRelatedField(
        queryset=Class.objects.all(), required=False, allow_null=True,
    )
    class_obj_detail = ClassMinimalSerializer(source='class_obj', read_only=True)

    class Meta:
        model = FaceCaptureDevice
        fields = [
            'id', 'name', 'device_id', 'scope_type', 'class_obj', 'class_obj_detail',
            'embedding_version', 'is_active', 'last_seen_at', 'created_at',
        ]
        read_only_fields = ['id', 'device_id', 'embedding_version', 'last_seen_at', 'created_at']

    def validate(self, attrs):
        scope_type = attrs.get('scope_type', getattr(self.instance, 'scope_type', None))
        if 'class_obj' in attrs:
            class_obj = attrs['class_obj']
        else:
            class_obj = getattr(self.instance, 'class_obj', None) if self.instance else None

        if scope_type == FaceCaptureDevice.ScopeType.CLASS and not class_obj:
            raise serializers.ValidationError('A CLASS-scoped device must have a class selected.')
        if scope_type == FaceCaptureDevice.ScopeType.SCHOOL and class_obj:
            raise serializers.ValidationError('A SCHOOL-scoped device must not have a class selected.')

        school = getattr(self.instance, 'school', None)
        if class_obj and school and class_obj.school_id != school.id:
            raise serializers.ValidationError('Selected class does not belong to this school.')

        return attrs


class FaceMatchFeedbackSerializer(serializers.Serializer):
    """
    Operator feedback on a single Live Mobile live-match result (design doc
    §10 backlog — groundwork for faceapi_v1 threshold tuning). Submitted by
    the teacher/guard who was physically present at capture time, since
    that's the only point a Live Mobile match can ever be verified against
    reality.
    """

    is_correct = serializers.BooleanField()


class FaceLiveDetectionEventSerializer(serializers.ModelSerializer):
    """Read-only — troubleshooting log for Fixed Camera live matching (design doc §4)."""

    device_name = serializers.CharField(source='device.name', read_only=True, default=None)
    class_obj = ClassMinimalSerializer(read_only=True)
    matched_student = StudentMinimalSerializer(read_only=True)

    class Meta:
        model = FaceLiveDetectionEvent
        fields = [
            'id', 'source_method', 'device', 'device_name', 'class_obj',
            'embedding_version', 'client_timestamp', 'received_at',
            'matched_student', 'confidence', 'distance', 'match_status',
            'resulted_in_attendance',
        ]
        read_only_fields = fields
