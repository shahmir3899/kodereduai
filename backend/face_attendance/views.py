"""
Face attendance views for capture, processing, review, and enrollment.
"""

import logging
from rest_framework import viewsets, status
from rest_framework.views import APIView
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser
from django.utils import timezone
from django.db import models as db_models

from core.permissions import IsSchoolAdmin, CanConfirmAttendance, ModuleAccessMixin
from core.mixins import TenantQuerySetMixin, ensure_tenant_school_id
from students.models import Student
from attendance.models import AttendanceRecord

from .models import FaceAttendanceSession, StudentFaceEmbedding, FaceDetectionResult
from .serializers import (
    FaceAttendanceSessionListSerializer,
    FaceAttendanceSessionDetailSerializer,
    FaceAttendanceSessionCreateSerializer,
    FaceAttendanceConfirmSerializer,
    StudentFaceEmbeddingSerializer,
    FaceEnrollSerializer,
)

logger = logging.getLogger(__name__)


class FaceImageUploadView(ModuleAccessMixin, APIView):
    """Upload face attendance images to Supabase storage."""

    required_module = 'attendance'
    permission_classes = [IsAuthenticated, IsSchoolAdmin]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        from core.storage import storage_service

        if 'image' not in request.FILES:
            return Response(
                {'error': 'No image file provided'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        image = request.FILES['image']
        school_id = ensure_tenant_school_id(request) or request.user.school_id
        class_id = request.data.get('class_id', 0)

        # Validate file type
        allowed_types = ['image/jpeg', 'image/png', 'image/webp']
        if image.content_type not in allowed_types:
            return Response(
                {'error': f'Invalid file type. Allowed: {", ".join(allowed_types)}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate file size (max 10MB)
        if image.size > 10 * 1024 * 1024:
            return Response(
                {'error': 'Image too large. Max 10MB.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not storage_service.is_configured():
            return Response(
                {'error': 'Storage service is not configured.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        try:
            public_url = storage_service.upload_attendance_image(
                image, school_id, class_id
            )
            return Response({'url': public_url}, status=status.HTTP_201_CREATED)
        except Exception as e:
            logger.exception('Face image upload failed')
            return Response(
                {'error': f'Upload failed: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class FaceAttendanceSessionViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    ViewSet for face attendance sessions.

    list: GET /sessions/ — list sessions for current school
    retrieve: GET /sessions/{id}/ — session detail with detections
    create: POST /sessions/ — create session and trigger processing
    pending_review: GET /sessions/pending_review/ — sessions needing review
    confirm: POST /sessions/{id}/confirm/ — confirm and create records
    reprocess: POST /sessions/{id}/reprocess/ — re-run pipeline
    """

    required_module = 'attendance'
    permission_classes = [IsAuthenticated, IsSchoolAdmin]
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        qs = FaceAttendanceSession.objects.select_related(
            'class_obj', 'school', 'created_by'
        )
        school_id = ensure_tenant_school_id(self.request)
        if school_id:
            qs = qs.filter(school_id=school_id)

        # Filtering
        class_obj = self.request.query_params.get('class_obj')
        if class_obj:
            qs = qs.filter(class_obj_id=class_obj)

        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)

        date_filter = self.request.query_params.get('date')
        if date_filter:
            qs = qs.filter(date=date_filter)

        return qs

    def get_serializer_class(self):
        if self.action == 'retrieve':
            return FaceAttendanceSessionDetailSerializer
        if self.action == 'create':
            return FaceAttendanceSessionCreateSerializer
        return FaceAttendanceSessionListSerializer

    def create(self, request, *args, **kwargs):
        """Create a face attendance session and trigger async processing."""
        serializer = self.get_serializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)

        school_id = ensure_tenant_school_id(request) or request.user.school_id
        class_obj = serializer.validated_data['class_obj']
        date = serializer.validated_data['date']
        image_url = serializer.validated_data['image_url']

        # Resolve academic year
        from academic_sessions.models import AcademicYear
        academic_year = AcademicYear.objects.filter(
            school_id=school_id, is_current=True
        ).first()

        # Create session
        session = FaceAttendanceSession.objects.create(
            school_id=school_id,
            class_obj=class_obj,
            academic_year=academic_year,
            date=date,
            image_url=image_url,
            status=FaceAttendanceSession.Status.PROCESSING,
            created_by=request.user,
        )

        # Dispatch Celery task
        try:
            from .tasks import process_face_session
            from core.task_utils import dispatch_background_task
            from core.models import BackgroundTask

            bg_task = dispatch_background_task(
                celery_task_func=process_face_session,
                task_type=BackgroundTask.TaskType.FACE_ATTENDANCE,
                title=f'Face attendance: {class_obj.name} - {date}',
                school_id=school_id,
                user=request.user,
                task_args=(str(session.id),),
                progress_total=5,  # 5 pipeline stages
            )
            session.celery_task_id = bg_task.celery_task_id
            session.save(update_fields=['celery_task_id'])
        except Exception as e:
            logger.exception('Failed to dispatch face processing task')
            session.status = FaceAttendanceSession.Status.FAILED
            session.error_message = f'Failed to start processing: {str(e)}'
            session.save(update_fields=['status', 'error_message'])

        return Response(
            FaceAttendanceSessionListSerializer(session).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=['get'], url_path='pending_review')
    def pending_review(self, request):
        """Get sessions that need teacher review."""
        qs = self.get_queryset().filter(
            status=FaceAttendanceSession.Status.NEEDS_REVIEW
        )

        # Auto-recover stuck PROCESSING sessions (>5 min old)
        stuck_cutoff = timezone.now() - timezone.timedelta(minutes=5)
        stuck = self.get_queryset().filter(
            status=FaceAttendanceSession.Status.PROCESSING,
            created_at__lt=stuck_cutoff,
        )
        if stuck.exists():
            stuck.update(
                status=FaceAttendanceSession.Status.FAILED,
                error_message='Processing timed out. Please reprocess.',
            )

        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = FaceAttendanceSessionListSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = FaceAttendanceSessionListSerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def confirm(self, request, pk=None):
        """Confirm face attendance and create AttendanceRecords."""
        session = self.get_object()

        if not session.can_be_confirmed:
            return Response(
                {'error': f'Session cannot be confirmed (status: {session.status})'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = FaceAttendanceConfirmSerializer(
            data=request.data,
            context={'request': request, 'session': session},
        )
        serializer.is_valid(raise_exception=True)

        present_ids = set(serializer.validated_data['present_student_ids'])
        removed_ids = serializer.validated_data.get('removed_detection_ids', [])
        corrections = serializer.validated_data.get('corrections', [])

        # Apply corrections to detections
        for correction in corrections:
            face_index = correction.get('detection_face_index')
            correct_student_id = correction.get('correct_student_id')
            if face_index is not None and correct_student_id:
                FaceDetectionResult.objects.filter(
                    session=session, face_index=face_index
                ).update(
                    matched_student_id=correct_student_id,
                    match_status=FaceDetectionResult.MatchStatus.MANUALLY_MATCHED,
                )

        # Mark removed detections
        if removed_ids:
            FaceDetectionResult.objects.filter(
                session=session, id__in=removed_ids
            ).update(match_status=FaceDetectionResult.MatchStatus.REMOVED)

        # Get all active students in the class
        class_students = Student.objects.filter(
            class_obj=session.class_obj, is_active=True
        )

        created_count = 0
        updated_count = 0
        errors = []

        for student in class_students:
            student_status = (
                AttendanceRecord.AttendanceStatus.PRESENT
                if student.id in present_ids
                else AttendanceRecord.AttendanceStatus.ABSENT
            )
            try:
                record, created = AttendanceRecord.objects.update_or_create(
                    student=student,
                    date=session.date,
                    defaults={
                        'school': session.school,
                        'academic_year': session.academic_year,
                        'status': student_status,
                        'source': AttendanceRecord.Source.FACE_CAMERA,
                        'face_session': session,
                    },
                )
                if created:
                    created_count += 1
                else:
                    updated_count += 1
            except Exception as e:
                errors.append(f'{student.name}: {str(e)}')

        # Update session
        session.status = FaceAttendanceSession.Status.CONFIRMED
        session.confirmed_by = request.user
        session.confirmed_at = timezone.now()
        session.save(update_fields=['status', 'confirmed_by', 'confirmed_at'])

        return Response({
            'success': True,
            'message': 'Face attendance confirmed successfully.',
            'total_students': class_students.count(),
            'present_count': len(present_ids),
            'absent_count': class_students.count() - len(present_ids),
            'created': created_count,
            'updated': updated_count,
            'errors': errors,
        })

    @action(detail=True, methods=['post'])
    def reprocess(self, request, pk=None):
        """Re-run the face processing pipeline."""
        session = self.get_object()

        if session.status == FaceAttendanceSession.Status.CONFIRMED:
            return Response(
                {'error': 'Cannot reprocess a confirmed session.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Clear existing detections
        session.detections.all().delete()

        # Reset status
        session.status = FaceAttendanceSession.Status.PROCESSING
        session.error_message = ''
        session.total_faces_detected = 0
        session.faces_matched = 0
        session.faces_flagged = 0
        session.faces_ignored = 0
        session.save()

        # Re-dispatch task
        try:
            from .tasks import process_face_session
            from core.task_utils import dispatch_background_task
            from core.models import BackgroundTask

            bg_task = dispatch_background_task(
                celery_task_func=process_face_session,
                task_type=BackgroundTask.TaskType.FACE_ATTENDANCE,
                title=f'Reprocess: {session.class_obj.name} - {session.date}',
                school_id=session.school_id,
                user=request.user,
                task_args=(str(session.id),),
                progress_total=5,
            )
            session.celery_task_id = bg_task.celery_task_id
            session.save(update_fields=['celery_task_id'])
        except Exception as e:
            session.status = FaceAttendanceSession.Status.FAILED
            session.error_message = str(e)
            session.save(update_fields=['status', 'error_message'])

        return Response({'status': 'reprocessing', 'session_id': str(session.id)})


class FaceEnrollmentViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    Manage student face embeddings (enrollment).

    list: GET /enrollments/ — list enrolled faces
    enroll: POST /enroll/ — enroll a student face
    destroy: DELETE /enrollments/{id}/ — remove an embedding
    """

    required_module = 'attendance'
    permission_classes = [IsAuthenticated, IsSchoolAdmin]
    serializer_class = StudentFaceEmbeddingSerializer
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def get_queryset(self):
        qs = StudentFaceEmbedding.objects.select_related(
            'student', 'student__class_obj'
        ).filter(is_active=True)

        school_id = ensure_tenant_school_id(self.request)
        if school_id:
            qs = qs.filter(school_id=school_id)

        # Filter by class
        class_obj = self.request.query_params.get('class_obj')
        if class_obj:
            qs = qs.filter(student__class_obj_id=class_obj)

        # Filter by student
        student_id = self.request.query_params.get('student')
        if student_id:
            qs = qs.filter(student_id=student_id)

        return qs

    @action(detail=False, methods=['post'])
    def enroll(self, request):
        """Enroll a student's face from an uploaded photo."""
        serializer = FaceEnrollSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        student = serializer.validated_data['student_id']
        image_url = serializer.validated_data['image_url']
        school_id = ensure_tenant_school_id(request) or request.user.school_id

        # Validate student belongs to school
        if student.school_id != school_id:
            return Response(
                {'error': 'Student does not belong to your school.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Dispatch async enrollment
        try:
            from .tasks import enroll_student_face
            from core.task_utils import dispatch_background_task
            from core.models import BackgroundTask

            bg_task = dispatch_background_task(
                celery_task_func=enroll_student_face,
                task_type=BackgroundTask.TaskType.FACE_ATTENDANCE,
                title=f'Enroll face: {student.name}',
                school_id=school_id,
                user=request.user,
                task_args=(student.id, image_url),
                progress_total=3,
            )
            return Response({
                'status': 'processing',
                'task_id': bg_task.celery_task_id,
                'student_id': student.id,
                'student_name': student.name,
            }, status=status.HTTP_202_ACCEPTED)
        except Exception as e:
            logger.exception('Failed to dispatch enrollment task')
            return Response(
                {'error': f'Enrollment failed: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    def perform_destroy(self, instance):
        """Soft-delete: deactivate rather than hard delete."""
        instance.is_active = False
        instance.save(update_fields=['is_active'])


class FaceAttendanceStatusView(ModuleAccessMixin, APIView):
    """Check face recognition system availability."""

    required_module = 'attendance'
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            import face_recognition  # noqa: F401
            face_available = True
        except ImportError:
            face_available = False

        from django.conf import settings
        fr_settings = getattr(settings, 'FACE_RECOGNITION_SETTINGS', {})

        school_id = ensure_tenant_school_id(request)
        enrollment_count = 0
        if school_id:
            enrollment_count = StudentFaceEmbedding.objects.filter(
                school_id=school_id, is_active=True
            ).count()

        return Response({
            'face_recognition_available': face_available,
            'thresholds': {
                'high': fr_settings.get('HIGH_CONFIDENCE_THRESHOLD', 0.40),
                'medium': fr_settings.get('MEDIUM_CONFIDENCE_THRESHOLD', 0.55),
            },
            'enrolled_faces': enrollment_count,
            'model': fr_settings.get('EMBEDDING_MODEL', 'dlib_v1'),
        })
