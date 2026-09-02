"""
Face attendance views for capture, processing, review, and enrollment.
"""

import logging
import numpy as np
from rest_framework import viewsets, status, generics
from rest_framework.views import APIView
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework_simplejwt.authentication import JWTAuthentication
from django.utils import timezone
from django.db import models as db_models

from core.permissions import (
    IsSchoolAdmin, CanConfirmAttendance, ModuleAccessMixin,
    get_effective_role, get_teacher_class_scope, ADMIN_ROLES,
)
from core.mixins import TenantQuerySetMixin, ensure_tenant_school_id
from core.class_scope import resolve_class_scope
from students.models import Student, Class
from attendance.models import AttendanceRecord
from .authentication import DeviceKeyAuthentication, IsAuthenticatedDevice
from .models import (
    FaceAttendanceSession, StudentFaceEmbedding, FaceDetectionResult,
    FaceCaptureDevice, FaceLiveDetectionEvent,
    FaceMatchThresholdSample, FaceAuditLog,
)
from .serializers import (
    FaceAttendanceSessionListSerializer,
    FaceAttendanceSessionDetailSerializer,
    FaceAttendanceSessionCreateSerializer,
    FaceAttendanceConfirmSerializer,
    StudentFaceEmbeddingSerializer,
    FaceEnrollSerializer,
    FaceEnrollWithEmbeddingSerializer,
    LiveMatchRequestSerializer,
    FaceCaptureDeviceSerializer,
    FaceLiveDetectionEventSerializer,
    FaceMatchFeedbackSerializer,
)
from .services.attendance_writer import upsert_attendance_record
from .services.embedding_service import EmbeddingService
from .services.matcher import FaceMatcher, find_duplicate_enrollment

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
        scope = resolve_class_scope(
            self.request,
            school_id=school_id,
            class_param_names=('class_obj', 'class_id'),
        )
        if scope['invalid']:
            return qs.none()

        class_obj = scope['class_obj_id']
        if class_obj:
            qs = qs.filter(class_obj_id=class_obj)

        academic_year_id = scope['academic_year_id'] or self.request.query_params.get('academic_year')
        if academic_year_id:
            qs = qs.filter(academic_year_id=academic_year_id)

        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)

        date_filter = self.request.query_params.get('date')
        if date_filter:
            qs = qs.filter(date=date_filter)

        # Prefetch detections with matched_student for detail view
        if self.action == 'retrieve':
            from django.db.models import Prefetch
            qs = qs.prefetch_related(
                Prefetch(
                    'detections',
                    queryset=FaceDetectionResult.objects.select_related('matched_student'),
                ),
            )

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
        scope = resolve_class_scope(
            request,
            school_id=school_id,
            include_body=True,
            class_param_names=('class_obj', 'class_id'),
        )
        if scope['invalid']:
            return Response({'error': scope['error']}, status=status.HTTP_400_BAD_REQUEST)

        class_obj = serializer.validated_data['class_obj']
        if scope['class_obj_id'] and str(class_obj.id) != str(scope['class_obj_id']):
            return Response(
                {'error': 'class_obj does not match session_class_id.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        date = serializer.validated_data['date']
        image_url = serializer.validated_data['image_url']

        # Resolve academic year
        from academic_sessions.models import AcademicYear
        if scope['academic_year_id']:
            academic_year = AcademicYear.objects.filter(
                school_id=school_id,
                id=scope['academic_year_id'],
                is_active=True,
            ).first()
            if not academic_year:
                return Response(
                    {'error': 'Invalid academic_year/session_class context.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
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

        # Apply corrections to detections. Fetched + saved one at a time
        # (rather than a single .update()) so the prior matched_student can
        # be read before it's overwritten — the audit log needs the
        # from/to pair, not just the new value.
        student_names_for_audit = {}
        if corrections:
            student_names_for_audit = dict(
                Student.objects.filter(
                    id__in=[c.get('correct_student_id') for c in corrections if c.get('correct_student_id')]
                ).values_list('id', 'name')
            )
        for correction in corrections:
            face_index = correction.get('detection_face_index')
            correct_student_id = correction.get('correct_student_id')
            if face_index is not None and correct_student_id:
                detection = FaceDetectionResult.objects.filter(
                    session=session, face_index=face_index
                ).select_related('matched_student').first()
                if not detection:
                    continue
                from_student_id = detection.matched_student_id
                from_student_name = detection.matched_student.name if detection.matched_student_id else None
                detection.matched_student_id = correct_student_id
                detection.match_status = FaceDetectionResult.MatchStatus.MANUALLY_MATCHED
                detection.save(update_fields=['matched_student_id', 'match_status'])
                FaceAuditLog.objects.create(
                    school=session.school,
                    event_type=FaceAuditLog.EventType.ADMIN_OVERRIDE,
                    student_id=correct_student_id,
                    actor=request.user,
                    metadata={
                        'session_id': str(session.id),
                        'detection_face_index': face_index,
                        'from_student_id': from_student_id,
                        'from_student_name': from_student_name,
                        'to_student_id': correct_student_id,
                        'to_student_name': student_names_for_audit.get(correct_student_id),
                    },
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
                record, created = upsert_attendance_record(
                    student=student,
                    date=session.date,
                    school=session.school,
                    academic_year=session.academic_year,
                    attendance_status=student_status,
                    face_session=session,
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

        # One batch-level audit row per confirmed session — not per matched
        # face, which would just duplicate the detections already stored on
        # the session itself (see FaceAuditLog's docstring).
        FaceAuditLog.objects.create(
            school=session.school,
            event_type=FaceAuditLog.EventType.ATTENDANCE_MATCH,
            student=None,
            actor=request.user,
            metadata={
                'session_id': str(session.id),
                'class_id': session.class_obj_id,
                'present_count': len(present_ids),
                'total_students': class_students.count(),
                'source_method': 'GROUP_PHOTO',
            },
        )

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

    def get_permissions(self):
        """
        Class-level IsSchoolAdmin is the default and stays in force for the
        legacy dlib enrollment flow (image_url) and for destroy — Group
        Photo capture stays admin-only, unchanged (design doc §8). Two narrow
        exceptions for Live Mobile capture, whose entire premise is a teacher
        capturing their own class rather than an admin:
        - list/retrieve: read-only, and the serializer never exposes the raw
          vector (just name/roll/class/quality/version), so opening it to
          CanConfirmAttendance (admin or teacher) carries no biometric-data
          exposure risk.
        - enroll, only when the payload uses the new client-embedding shape
          (detected by the 'embedding' key, distinct from the legacy
          {student_id, image_url} shape) — the faceapi_v1 guided-capture path.
        """
        if self.action in ('list', 'retrieve'):
            return [IsAuthenticated(), CanConfirmAttendance()]
        if self.action == 'enroll' and 'embedding' in self.request.data:
            return [IsAuthenticated(), CanConfirmAttendance()]
        return super().get_permissions()

    def get_queryset(self):
        qs = StudentFaceEmbedding.objects.select_related(
            'student', 'student__class_obj'
        ).filter(is_active=True)

        school_id = ensure_tenant_school_id(self.request)
        if school_id:
            qs = qs.filter(school_id=school_id)

        # A teacher only sees enrollment metadata for their own classes —
        # list/retrieve were opened up to CanConfirmAttendance above, but
        # that shouldn't mean whole-school visibility for a teacher role.
        role = get_effective_role(self.request)
        if role == 'TEACHER':
            qs = qs.filter(
                student__class_obj_id__in=get_teacher_class_scope(self.request, school_id=school_id)
            )

        # Filter by class
        scope = resolve_class_scope(
            self.request,
            school_id=school_id,
            class_param_names=('class_obj', 'class_id'),
        )
        if scope['invalid']:
            return qs.none()

        class_obj = scope['class_obj_id']
        if class_obj:
            qs = qs.filter(student__class_obj_id=class_obj)

        # Filter by student
        student_id = self.request.query_params.get('student')
        if student_id:
            qs = qs.filter(student_id=student_id)

        return qs

    @action(detail=False, methods=['post'])
    def enroll(self, request):
        """Enroll a student's face — legacy photo (dlib/Celery) or client-side embedding (faceapi_v1)."""
        if 'embedding' in request.data:
            return self._enroll_with_embedding(request)
        return self._enroll_from_image(request)

    def _enroll_from_image(self, request):
        """Legacy path: enroll a student's face from an uploaded photo."""
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
                task_args=(student.id, image_url, request.user.id, serializer.validated_data.get('override_duplicate', False)),
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

    def _enroll_with_embedding(self, request):
        """
        Live Mobile capture path (design doc §5): the embedding was already
        extracted client-side by face-api.js, so this is synchronous — no
        Celery dispatch, no face_recognition/dlib involved.
        """
        serializer = FaceEnrollWithEmbeddingSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        student = data['student_id']
        school_id = ensure_tenant_school_id(request) or request.user.school_id

        if student.school_id != school_id:
            return Response(
                {'error': 'Student does not belong to your school.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        role = get_effective_role(request)
        if role == 'TEACHER' and student.class_obj_id not in get_teacher_class_scope(request, school_id=school_id):
            return Response(
                {'error': 'You are not assigned as class teacher for this student.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        duplicate_override_used = data.get('override_duplicate', False)
        embedding_array = np.array(data['embedding'], dtype=np.float64)
        duplicate = find_duplicate_enrollment(
            embedding_array, school_id, exclude_student_id=student.id,
            embedding_version=data['embedding_version'],
        )
        if duplicate and not duplicate_override_used:
            return Response({
                'error': 'duplicate_face',
                'message': (
                    f"This face closely matches an existing enrollment for "
                    f"{duplicate.student_name} ({duplicate.confidence:.0f}% confidence)."
                ),
                'matched_student': {'id': duplicate.student_id, 'name': duplicate.student_name},
                'confidence': duplicate.confidence,
            }, status=status.HTTP_409_CONFLICT)
        # Overridden (or no duplicate found) — still worth noting on the
        # audit entry which student it was confused with, if any.
        duplicate_info = {
            'matched_student_id': duplicate.student_id,
            'matched_student_name': duplicate.student_name,
            'confidence': duplicate.confidence,
        } if duplicate else None

        had_prior_embedding = StudentFaceEmbedding.objects.filter(
            student=student, is_active=True
        ).exists()

        face_embedding = EmbeddingService.store_client_embedding(
            student_id=student.id,
            school_id=school_id,
            embedding=data['embedding'],
            embedding_version=data['embedding_version'],
            quality_score=data['quality_score'],
        )

        FaceAuditLog.objects.create(
            school_id=school_id,
            event_type=FaceAuditLog.EventType.RE_ENROLLMENT if had_prior_embedding else FaceAuditLog.EventType.ENROLLMENT,
            student=student,
            actor=request.user,
            metadata={
                'embedding_version': data['embedding_version'],
                'quality_score': data['quality_score'],
                'source': 'live_capture',
                **({'duplicate_override': duplicate_info} if duplicate_info else {}),
            },
        )

        return Response(
            StudentFaceEmbeddingSerializer(face_embedding).data,
            status=status.HTTP_201_CREATED,
        )

    def perform_destroy(self, instance):
        """Soft-delete: deactivate rather than hard delete."""
        instance.is_active = False
        instance.save(update_fields=['is_active'])


LIVE_MOBILE_EMBEDDING_VERSION = 'faceapi_v1'


class LiveMatchView(APIView):
    """
    POST /api/face-attendance/live/match/

    Shared ingest endpoint for both live capture methods: an on-prem device
    (Fixed Camera, device-key auth) or a teacher's/guard's browser session
    (Live Mobile, JWT) posts a single face embedding (already extracted
    locally) and gets back a match result. Two authentication paths,
    composed permission (device OR CanConfirmAttendance) — see design doc
    §4/§8. Stays lightweight by design: no image processing, no Celery
    dispatch.

    source_method is deliberately NOT accepted from the client — it's derived
    from which authentication path succeeded (device key -> Fixed Camera,
    JWT -> Live Mobile), so a caller can't misdeclare which method it's
    reporting as.
    """

    authentication_classes = [DeviceKeyAuthentication, JWTAuthentication]
    permission_classes = [IsAuthenticatedDevice | CanConfirmAttendance]

    def post(self, request):
        serializer = LiveMatchRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        if isinstance(request.auth, FaceCaptureDevice):
            return self._handle_fixed_camera(request, data)
        return self._handle_live_mobile(request, data)

    def _handle_fixed_camera(self, request, data):
        device = request.auth

        # Coarse gate (unchanged from every other face_attendance view):
        # the school must have the 'attendance' module enabled at all.
        if not device.school.get_enabled_module('attendance'):
            return Response(
                {'error': 'The Attendance module is not enabled for this school.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        # No separate "Fixed Camera enabled" gate: a device that
        # authenticates via a valid, active API key (DeviceKeyAuthentication)
        # has already proven the school has Fixed Camera capture installed —
        # that IS the gate. See FaceAttendanceStatusView for how
        # fixed_camera_status is derived for display purposes only.

        if data['embedding_version'] != device.embedding_version:
            return Response(
                {'error': "embedding_version does not match this device's configured version."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if device.scope_type == FaceCaptureDevice.ScopeType.CLASS:
            class_id = data.get('class_id')
            if class_id is not None and str(class_id) != str(device.class_obj_id):
                return Response(
                    {'error': "class_id does not match this device's assigned class."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            class_obj = device.class_obj
            candidate_ids = EmbeddingService.get_class_student_ids(
                class_obj.id, device.school_id, embedding_version=device.embedding_version,
            )
            student_names = dict(
                Student.objects.filter(class_obj=class_obj, is_active=True).values_list('id', 'name')
            )
        else:
            class_obj = None
            candidate_ids = EmbeddingService.get_school_student_ids(
                device.school_id, embedding_version=device.embedding_version,
            )
            student_names = dict(
                Student.objects.filter(school_id=device.school_id, is_active=True).values_list('id', 'name')
            )

        response = self._match_and_record(
            data=data,
            school=device.school,
            school_id=device.school_id,
            class_obj=class_obj,
            embedding_version=device.embedding_version,
            candidate_ids=candidate_ids,
            student_names=student_names,
            source_method=FaceLiveDetectionEvent.CaptureMethod.FIXED_CAMERA,
            device=device,
            captured_by=None,
        )
        FaceCaptureDevice.objects.filter(pk=device.pk).update(last_seen_at=timezone.now())
        return response

    def _handle_live_mobile(self, request, data):
        # NOT request.tenant_school — TenantMiddleware.process_view() runs
        # before DRF authentication populates request.user, so for a
        # header-only JWT request (no Django session) it never resolves
        # tenant_school/tenant_school_id. ensure_tenant_school_id() is the
        # existing app-wide workaround (see its docstring in core/mixins.py).
        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response(
                {'error': 'No active school context (X-School-ID header required).'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from schools.models import School
        try:
            school = School.objects.get(pk=school_id)
        except School.DoesNotExist:
            return Response({'error': 'Invalid school context.'}, status=status.HTTP_400_BAD_REQUEST)

        # Coarse gate (unchanged from every other face_attendance view).
        if not school.get_enabled_module('attendance'):
            return Response(
                {'error': 'The Attendance module is not enabled for this school.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        # No separate "Live Mobile enabled" gate — mobile-browser live
        # capture is unconditionally available to every school (confirmed
        # product decision). Availability here is governed only by the
        # coarse module gate above and the CanConfirmAttendance permission
        # (admin-or-assigned-teacher) already applied to this view.

        if data['embedding_version'] != LIVE_MOBILE_EMBEDDING_VERSION:
            return Response(
                {'error': f"Live Mobile capture embedding_version must be '{LIVE_MOBILE_EMBEDDING_VERSION}'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        role = get_effective_role(request)
        class_id = data.get('class_id')

        if role == 'TEACHER':
            # A teacher's phone always represents one class in front of
            # them — unlike an admin/guard, there's no whole-school scope.
            if not class_id:
                return Response(
                    {'error': 'class_id is required for teacher-submitted Live Mobile capture events.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if class_id not in get_teacher_class_scope(request, school_id=school.id):
                return Response(
                    {'error': 'You are not assigned as class teacher for this class.'},
                    status=status.HTTP_403_FORBIDDEN,
                )
            class_obj = Class.objects.filter(pk=class_id, school_id=school.id).first()
            if not class_obj:
                return Response({'error': 'Invalid class_id.'}, status=status.HTTP_400_BAD_REQUEST)
            candidate_ids = EmbeddingService.get_class_student_ids(
                class_obj.id, school.id, embedding_version=LIVE_MOBILE_EMBEDDING_VERSION,
            )
            student_names = dict(
                Student.objects.filter(class_obj=class_obj, is_active=True).values_list('id', 'name')
            )
        else:
            # CanConfirmAttendance only allows ADMIN_ROLES or TEACHER, so
            # this is an admin/principal — e.g. a gate guard's account.
            # Whole-school scope when no class_id is given, same as a
            # SCHOOL-scoped Fixed Camera device.
            if class_id:
                class_obj = Class.objects.filter(pk=class_id, school_id=school.id).first()
                if not class_obj:
                    return Response({'error': 'Invalid class_id.'}, status=status.HTTP_400_BAD_REQUEST)
                candidate_ids = EmbeddingService.get_class_student_ids(
                    class_obj.id, school.id, embedding_version=LIVE_MOBILE_EMBEDDING_VERSION,
                )
                student_names = dict(
                    Student.objects.filter(class_obj=class_obj, is_active=True).values_list('id', 'name')
                )
            else:
                class_obj = None
                candidate_ids = EmbeddingService.get_school_student_ids(
                    school.id, embedding_version=LIVE_MOBILE_EMBEDDING_VERSION,
                )
                student_names = dict(
                    Student.objects.filter(school_id=school.id, is_active=True).values_list('id', 'name')
                )

        return self._match_and_record(
            data=data,
            school=school,
            school_id=school.id,
            class_obj=class_obj,
            embedding_version=LIVE_MOBILE_EMBEDDING_VERSION,
            candidate_ids=candidate_ids,
            student_names=student_names,
            source_method=FaceLiveDetectionEvent.CaptureMethod.LIVE_MOBILE,
            device=None,
            captured_by=request.user,
        )

    def _match_and_record(self, *, data, school, school_id, class_obj, embedding_version,
                           candidate_ids, student_names, source_method, device, captured_by):
        """Shared by both capture methods: run the pgvector match, apply per-day dedup, write the event."""
        embedding_array = np.array(data['embedding'], dtype=np.float64)
        matcher = FaceMatcher()
        results = matcher.match_faces(
            [(0, embedding_array)], candidate_ids, school_id,
            student_names=student_names, embedding_version=embedding_version,
        )
        result = results[0]

        event_date = data['timestamp'].date()
        resulted_in_attendance = False
        attendance_record = None

        if result.match_status == FaceLiveDetectionEvent.MatchStatus.AUTO_MATCHED and result.student_id:
            already_marked_today = FaceLiveDetectionEvent.objects.filter(
                matched_student_id=result.student_id,
                client_timestamp__date=event_date,
                resulted_in_attendance=True,
            ).exists()
            if not already_marked_today:
                from academic_sessions.models import AcademicYear

                academic_year = AcademicYear.objects.filter(
                    school_id=school_id, is_current=True
                ).first()
                student = Student.objects.get(pk=result.student_id)
                attendance_record, _ = upsert_attendance_record(
                    student=student,
                    date=event_date,
                    school=school,
                    academic_year=academic_year,
                    attendance_status=AttendanceRecord.AttendanceStatus.PRESENT,
                )
                resulted_in_attendance = True

        event = FaceLiveDetectionEvent.objects.create(
            school=school,
            class_obj=class_obj,
            source_method=source_method,
            device=device,
            captured_by=captured_by,
            embedding_version=embedding_version,
            client_timestamp=data['timestamp'],
            matched_student_id=result.student_id,
            confidence=result.confidence,
            distance=None if result.distance == float('inf') else result.distance,
            match_status=result.match_status,
            resulted_in_attendance=resulted_in_attendance,
            attendance_record=attendance_record,
        )

        if resulted_in_attendance:
            # Only the consequential case is audited here — the event
            # itself already covers every attempt, matched or not; this
            # table is for "attendance was actually written," not a mirror
            # of FaceLiveDetectionEvent's per-poll-tick volume.
            FaceAuditLog.objects.create(
                school=school,
                event_type=FaceAuditLog.EventType.ATTENDANCE_MATCH,
                student_id=result.student_id,
                actor=captured_by,
                metadata={
                    'confidence': result.confidence,
                    'distance': None if result.distance == float('inf') else result.distance,
                    'source_method': source_method,
                    'class_id': class_obj.id if class_obj else None,
                    'device_id': str(device.device_id) if device else None,
                    'live_event_id': str(event.id),
                },
            )

        return Response({
            'match_status': result.match_status,
            'student': (
                {'id': result.student_id, 'name': result.student_name}
                if result.student_id else None
            ),
            'confidence': result.confidence,
            'event_id': str(event.id),
            'attendance_marked': resulted_in_attendance,
        })


class LiveMatchFeedbackView(APIView):
    """
    POST /api/face-attendance/live/events/<event_id>/feedback/

    Groundwork for empirically tuning faceapi_v1's thresholds (design doc
    §10 backlog): Live Mobile capture never stores an image, so the operator
    (teacher/guard) holding the phone at capture time is the only one who can
    ever say whether a match was actually correct. This endpoint turns that
    fleeting judgment into a durable, stripped-down labeled sample before
    the source FaceLiveDetectionEvent gets purged 48h later.

    Only AUTO_MATCHED/FLAGGED events are eligible — those are the only
    ones that showed the operator a candidate student to confirm/dispute
    (see FaceLiveCapturePage's feedbackBanner()). Fixed Camera capture is
    out of scope: there's no human operator present per-event to supply
    the label.
    """

    permission_classes = [IsAuthenticated, CanConfirmAttendance]

    def post(self, request, event_id):
        try:
            event = FaceLiveDetectionEvent.objects.select_related('school').get(pk=event_id)
        except FaceLiveDetectionEvent.DoesNotExist:
            return Response(
                {'error': 'Event not found (it may already have been purged).'},
                status=status.HTTP_404_NOT_FOUND,
            )

        if event.source_method != FaceLiveDetectionEvent.CaptureMethod.LIVE_MOBILE:
            return Response(
                {'error': 'Feedback is only accepted for Live Mobile capture events.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if event.match_status not in (
            FaceLiveDetectionEvent.MatchStatus.AUTO_MATCHED,
            FaceLiveDetectionEvent.MatchStatus.FLAGGED,
        ):
            return Response(
                {'error': 'Feedback only applies to AUTO_MATCHED or FLAGGED events.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        role = get_effective_role(request)
        is_capturing_operator = event.captured_by_id == request.user.id
        is_school_admin = role in ADMIN_ROLES and event.school_id == ensure_tenant_school_id(request)
        if not (is_capturing_operator or is_school_admin):
            return Response(
                {'error': 'Only the operator who captured this event, or a school admin, can label it.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = FaceMatchFeedbackSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        FaceMatchThresholdSample.objects.create(
            school=event.school,
            source_method=event.source_method,
            embedding_version=event.embedding_version,
            distance=event.distance,
            predicted_match_status=event.match_status,
            is_correct=serializer.validated_data['is_correct'],
            sample_date=event.client_timestamp.date(),
        )

        return Response(status=status.HTTP_201_CREATED)


class FaceCaptureDeviceViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    Read + limited edit for Fixed Camera capture devices — school admins
    manage devices that were provisioned via Django admin (see design doc §9.4).

    list: GET /devices/ — devices for the current school
    retrieve: GET /devices/{id}/
    partial_update: PATCH /devices/{id}/ — name/scope_type/class_obj/is_active only
    No create/destroy: device provisioning (and the one-time key display)
    stays a Django-admin-only action.
    """

    required_module = 'attendance'
    permission_classes = [IsAuthenticated, IsSchoolAdmin]
    serializer_class = FaceCaptureDeviceSerializer
    http_method_names = ['get', 'patch', 'head', 'options']

    def get_queryset(self):
        qs = FaceCaptureDevice.objects.select_related('school', 'class_obj')
        school_id = ensure_tenant_school_id(self.request)
        if school_id:
            qs = qs.filter(school_id=school_id)
        return qs


class FaceLiveDetectionEventListView(ModuleAccessMixin, generics.ListAPIView):
    """
    GET /live/events/ — troubleshooting log for Fixed Camera live matching
    (design doc §4). Read-only, filterable by date and device.
    """

    required_module = 'attendance'
    permission_classes = [IsAuthenticated, IsSchoolAdmin]
    serializer_class = FaceLiveDetectionEventSerializer

    def get_queryset(self):
        qs = FaceLiveDetectionEvent.objects.select_related(
            'device', 'class_obj', 'matched_student'
        )
        school_id = ensure_tenant_school_id(self.request)
        if school_id:
            qs = qs.filter(school_id=school_id)
        else:
            return qs.none()

        date_filter = self.request.query_params.get('date')
        if date_filter:
            qs = qs.filter(client_timestamp__date=date_filter)

        device_id = self.request.query_params.get('device')
        if device_id:
            qs = qs.filter(device_id=device_id)

        return qs



# A device that hasn't posted a match in this long is reported as inactive
# rather than active. Mirrors the frontend's own OFFLINE_THRESHOLD_MS
# (FaceDevicesPage.jsx) — kept as a separate constant here rather than a
# shared settings value since the two ends change independently in practice.
FIXED_CAMERA_OFFLINE_THRESHOLD = timezone.timedelta(minutes=5)


def _fixed_camera_status(school_id):
    """
    Fixed Camera capture has no "enabled" flag — it's a background on-prem
    device that either exists at a school or doesn't (confirmed product
    decision). Status is derived entirely from FaceCaptureDevice rows:
      - 'not_installed': no active device registered for this school
      - 'active': at least one active device has posted within the last
        FIXED_CAMERA_OFFLINE_THRESHOLD
      - 'inactive': active device(s) exist, but none have posted recently
    """
    if not school_id:
        return 'not_installed'

    last_seen_values = list(
        FaceCaptureDevice.objects.filter(
            school_id=school_id, is_active=True,
        ).values_list('last_seen_at', flat=True)
    )
    if not last_seen_values:
        return 'not_installed'

    cutoff = timezone.now() - FIXED_CAMERA_OFFLINE_THRESHOLD
    if any(seen and seen >= cutoff for seen in last_seen_values):
        return 'active'
    return 'inactive'


class FaceAttendanceStatusView(ModuleAccessMixin, APIView):
    """Check face recognition system availability."""

    required_module = 'attendance'
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            import face_recognition  # noqa: F401
            face_available = True
        except (ImportError, SystemExit):
            # face_recognition/api.py calls quit() -> SystemExit (not
            # ImportError) when its own face_recognition_models dependency
            # fails to import (e.g. missing pkg_resources). Uncaught,
            # SystemExit escapes Django's middleware chain entirely — the
            # response goes out with no CORS headers, which surfaces to the
            # frontend as a CORS error instead of a normal 500.
            face_available = False

        from django.conf import settings

        from face_attendance.services.matcher import get_thresholds

        fr_settings = getattr(settings, 'FACE_RECOGNITION_SETTINGS', {})
        embedding_version = fr_settings.get('EMBEDDING_MODEL', 'dlib_v1')

        school_id = ensure_tenant_school_id(request)
        enrollment_count = 0
        if school_id:
            enrollment_count = StudentFaceEmbedding.objects.filter(
                school_id=school_id, is_active=True
            ).count()

        return Response({
            'face_recognition_available': face_available,
            'thresholds': get_thresholds(embedding_version),
            'enrolled_faces': enrollment_count,
            'model': embedding_version,
            # Group Photo and Live Mobile capture are unconditionally
            # available to every school — no per-school flag left to
            # consult (see FaceAttendanceSchoolConfig).
            'group_photo_available': True,
            'live_mobile_available': True,
            'fixed_camera_status': _fixed_camera_status(school_id),
        })
