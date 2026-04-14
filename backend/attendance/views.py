"""
Attendance views for upload, review, and confirmation workflow.
"""

import logging
from rest_framework import viewsets, status
from rest_framework.views import APIView
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.db.models import Count, Q

from core.permissions import IsSchoolAdmin, HasSchoolAccess, CanConfirmAttendance, CanUploadAttendance, CanManualAttendance, ModuleAccessMixin, get_effective_role, ADMIN_ROLES, get_teacher_class_scope, get_teacher_session_class_scope, _get_session_class_student_ids
from core.mixins import TenantQuerySetMixin, ensure_tenant_schools, ensure_tenant_school_id
from academic_sessions.calendar_rules import is_off_day_for_date, off_day_types_for_date, build_off_day_date_set
from .models import AttendanceUpload, AttendanceRecord
from .serializers import (
    AttendanceUploadSerializer,
    AttendanceUploadDetailSerializer,
    AttendanceUploadCreateSerializer,
    AttendanceConfirmSerializer,
    AttendanceRecordSerializer,
)
from students.models import Student

logger = logging.getLogger(__name__)


def _resolve_session_class_filter(request):
    """Resolve session_class_id into (class_obj_id, academic_year_id)."""
    session_class_id = request.query_params.get('session_class_id')
    if not session_class_id:
        return (None, None)

    from academic_sessions.models import SessionClass

    school_id = ensure_tenant_school_id(request)
    qs = SessionClass.objects.filter(id=session_class_id)
    if school_id:
        qs = qs.filter(school_id=school_id)
    session_class = qs.first()
    if not session_class or not session_class.class_obj_id:
        return (None, None)
    return (session_class.class_obj_id, session_class.academic_year_id)


class ImageUploadView(ModuleAccessMixin, APIView):
    """
    Upload attendance images to Supabase storage.
    """
    required_module = 'attendance'
    permission_classes = [IsAuthenticated, CanUploadAttendance]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        """Upload image and return public URL."""
        from core.storage import storage_service

        if 'image' not in request.FILES:
            return Response(
                {'error': 'No image file provided'},
                status=status.HTTP_400_BAD_REQUEST
            )

        image = request.FILES['image']
        school_id = request.data.get('school_id') or ensure_tenant_school_id(request) or request.user.school_id
        class_id = request.data.get('class_id', 0)

        # Validate school access
        if not request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(request)
            if int(school_id) not in tenant_schools:
                return Response(
                    {'error': 'Access denied to this school'},
                    status=status.HTTP_403_FORBIDDEN
                )

        # Validate file type
        allowed_types = ['image/jpeg', 'image/png', 'image/webp']
        if image.content_type not in allowed_types:
            return Response(
                {'error': f'Invalid file type. Allowed: {", ".join(allowed_types)}'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Validate file size (10MB max)
        max_size = 10 * 1024 * 1024
        if image.size > max_size:
            return Response(
                {'error': 'File too large. Maximum size is 10MB'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            url = storage_service.upload_attendance_image(image, school_id, class_id)
            return Response({'url': url}, status=status.HTTP_201_CREATED)
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class AttendanceUploadViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    required_module = 'attendance'
    """
    ViewSet for managing attendance uploads.

    Workflow:
    1. POST /uploads/ - Upload image (status = PROCESSING)
    2. GET /uploads/{id}/ - Check status and view AI results
    3. POST /uploads/{id}/confirm/ - Confirm attendance
    """
    queryset = AttendanceUpload.objects.all()
    permission_classes = [IsAuthenticated, CanUploadAttendance, HasSchoolAccess]

    def get_serializer_class(self):
        if self.action == 'create':
            return AttendanceUploadCreateSerializer
        if self.action == 'retrieve':
            return AttendanceUploadDetailSerializer
        if self.action == 'confirm':
            return AttendanceConfirmSerializer
        return AttendanceUploadSerializer

    def create(self, request, *args, **kwargs):
        """Override create to add detailed logging."""
        logger.info(f"=== ATTENDANCE UPLOAD CREATE ===")
        logger.info(f"User: {request.user} (school_id: {ensure_tenant_school_id(request) or request.user.school_id})")
        logger.info(f"Request data: {request.data}")

        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            logger.error(f"Validation errors: {serializer.errors}")
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        logger.info(f"Validated data: {serializer.validated_data}")
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        logger.info(f"Upload created successfully: {serializer.data}")
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def get_queryset(self):
        queryset = AttendanceUpload.objects.select_related(
            'school', 'class_obj', 'created_by', 'confirmed_by', 'academic_year'
        ).prefetch_related('images')

        # Filter by active school (works for all users including super admin)
        active_school_id = ensure_tenant_school_id(self.request)
        if active_school_id:
            queryset = queryset.filter(school_id=active_school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        # Filter by school if provided (overrides active school)
        school_id = self.request.query_params.get('school_id')
        if school_id:
            queryset = queryset.filter(school_id=school_id)

        # Resolve scope first so class filtering can remain year-consistent.
        academic_year_id = self.request.query_params.get('academic_year')
        class_id = self.request.query_params.get('class_id')
        session_class_obj_id, session_class_year_id = _resolve_session_class_filter(self.request)
        if session_class_obj_id:
            class_id = session_class_obj_id
        if not academic_year_id and session_class_year_id:
            academic_year_id = session_class_year_id
        if academic_year_id and session_class_year_id and str(academic_year_id) != str(session_class_year_id):
            return queryset.none()

        if class_id:
            queryset = queryset.filter(class_obj_id=class_id)

        # Filter by status
        upload_status = self.request.query_params.get('status')
        if upload_status:
            queryset = queryset.filter(status=upload_status)

        # Filter by academic year
        if academic_year_id:
            queryset = queryset.filter(academic_year_id=academic_year_id)

        # Filter by date range
        date_from = self.request.query_params.get('date_from')
        date_to = self.request.query_params.get('date_to')
        if date_from:
            queryset = queryset.filter(date__gte=date_from)
        if date_to:
            queryset = queryset.filter(date__lte=date_to)

        # Teacher: only see uploads for their assigned classes (section-scoped)
        role = get_effective_role(self.request)
        if role == 'TEACHER':
            session_class_ids = get_teacher_session_class_scope(self.request)
            if session_class_ids:
                # Section-level: filter uploads where session_class is assigned
                queryset = queryset.filter(
                    Q(session_class_id__in=session_class_ids) |
                    Q(session_class__isnull=True, class_obj_id__in=get_teacher_class_scope(self.request))
                )
            else:
                teacher_class_ids = get_teacher_class_scope(self.request)
                queryset = queryset.filter(class_obj_id__in=teacher_class_ids)

        return queryset.order_by('-created_at')

    def perform_create(self, serializer):
        """Create upload and trigger processing task."""
        # Teacher: verify class-teacher assignment (section-scoped if applicable)
        role = get_effective_role(self.request)
        if role == 'TEACHER':
            class_obj_id = serializer.validated_data.get('class_obj') and serializer.validated_data['class_obj'].id
            if not class_obj_id:
                class_obj_id = self.request.data.get('class_obj')
            # Check session_class assignment if provided
            session_class_id = self.request.data.get('session_class_id') or self.request.data.get('session_class')
            session_class_ids = get_teacher_session_class_scope(self.request)
            if session_class_id and session_class_ids:
                if int(session_class_id) not in session_class_ids:
                    from rest_framework.exceptions import PermissionDenied
                    raise PermissionDenied('You are not assigned as class teacher for this class section.')
            else:
                teacher_class_ids = get_teacher_class_scope(self.request)
                if int(class_obj_id) not in teacher_class_ids:
                    from rest_framework.exceptions import PermissionDenied
                    raise PermissionDenied('You are not assigned as class teacher for this class.')

        # Auto-resolve academic year if not provided
        academic_year = serializer.validated_data.get('academic_year')
        if not academic_year:
            from academic_sessions.models import AcademicYear
            school_id = ensure_tenant_school_id(self.request) or self.request.user.school_id
            academic_year = AcademicYear.objects.filter(
                school_id=school_id, is_current=True, is_active=True,
            ).first()

        upload = serializer.save(
            created_by=self.request.user,
            status=AttendanceUpload.Status.PROCESSING,
            academic_year=academic_year,
        )

        # Try to use Celery if available, otherwise process synchronously
        try:
            from .tasks import process_attendance_upload
            process_attendance_upload.delay(upload.id)
        except Exception as e:
            # Celery/Redis not available, process synchronously
            import logging
            logger = logging.getLogger(__name__)
            logger.warning(f"Celery not available, processing synchronously: {e}")
            self._process_upload_sync(upload.id)

    def _process_upload_sync(self, upload_id: int):
        """Process attendance upload synchronously (fallback when Celery unavailable).

        Note: For now, just mark as REVIEW_REQUIRED and skip AI processing
        since Tesseract/Groq may not be configured.
        """
        from .models import AttendanceUpload
        import logging
        logger = logging.getLogger(__name__)

        try:
            upload = AttendanceUpload.objects.get(id=upload_id)
        except AttendanceUpload.DoesNotExist:
            logger.error(f"AttendanceUpload {upload_id} not found")
            return

        logger.info(f"Processing attendance upload {upload_id}")

        # Use the new processing pipeline: OCR → Table → LLM Reasoning
        try:
            from .attendance_processor import AttendanceProcessor
            processor = AttendanceProcessor(upload)
            result = processor.process()

            if result.success:
                upload.ai_output_json = result.to_ai_output_json()
                upload.confidence_score = result.confidence
                upload.status = AttendanceUpload.Status.REVIEW_REQUIRED
                upload.save()
                logger.info(f"Upload {upload_id} processed successfully with AI pipeline")
            else:
                # AI failed, but still allow manual review
                upload.status = AttendanceUpload.Status.REVIEW_REQUIRED
                upload.error_message = f"AI processing failed at {result.error_stage}: {result.error}"
                upload.ai_output_json = {'matched': [], 'unmatched': [], 'notes': 'AI processing unavailable'}
                upload.save()
                logger.warning(f"Upload {upload_id} AI failed, set for manual review: {result.error}")

        except Exception as e:
            logger.warning(f"AI processing error for upload {upload_id}: {e}")
            # Still allow manual review even if AI fails
            upload.status = AttendanceUpload.Status.REVIEW_REQUIRED
            upload.error_message = f"AI unavailable: {str(e)[:200]}"
            upload.ai_output_json = {'matched': [], 'unmatched': [], 'notes': 'AI processing unavailable'}
            upload.save()
            logger.info(f"Upload {upload_id} set for manual review (AI unavailable)")

    def destroy(self, request, *args, **kwargs):
        """
        Delete an attendance upload.
        Only non-confirmed uploads can be deleted.
        """
        upload = self.get_object()

        if upload.status == AttendanceUpload.Status.CONFIRMED:
            return Response(
                {'error': 'Cannot delete a confirmed attendance upload. The records have already been created.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        logger.info(f"Deleting attendance upload {upload.id} (status: {upload.status})")

        # Delete associated images from storage if needed
        # (Supabase cascade should handle DB records)

        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['post'], permission_classes=[CanConfirmAttendance])
    def confirm(self, request, pk=None):
        """
        Confirm attendance and create records.

        This is the CRITICAL action that:
        1. Creates AttendanceRecords for all students
        2. Marks absent students based on confirmed list
        3. Triggers WhatsApp notifications (if enabled)
        """
        upload = self.get_object()

        # Teacher: verify class assignment (section-scoped if applicable)
        role = get_effective_role(request)
        if role == 'TEACHER':
            session_class_ids = get_teacher_session_class_scope(request)
            if session_class_ids and upload.session_class_id:
                if upload.session_class_id not in session_class_ids:
                    return Response(
                        {'error': 'You are not assigned as class teacher for this class section.'},
                        status=status.HTTP_403_FORBIDDEN,
                    )
            else:
                teacher_class_ids = get_teacher_class_scope(request)
                if upload.class_obj_id not in teacher_class_ids:
                    return Response(
                        {'error': 'You are not assigned as class teacher for this class.'},
                        status=status.HTTP_403_FORBIDDEN,
                    )

        # Validate upload can be confirmed
        if upload.status == AttendanceUpload.Status.CONFIRMED:
            return Response(
                {'error': 'This upload has already been confirmed.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if upload.status not in [
            AttendanceUpload.Status.REVIEW_REQUIRED,
            AttendanceUpload.Status.PROCESSING
        ]:
            return Response(
                {'error': f'Cannot confirm upload with status: {upload.get_status_display()}'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Validate request data
        serializer = AttendanceConfirmSerializer(
            data=request.data,
            context={'upload': upload, 'request': request}
        )
        serializer.is_valid(raise_exception=True)

        # Do not allow attendance confirmation on configured OFF days.
        if is_off_day_for_date(upload.school_id, upload.date, class_id=upload.class_obj_id):
            return Response(
                {
                    'error': 'Attendance cannot be confirmed on an OFF day.',
                    'off_day_types': off_day_types_for_date(upload.school_id, upload.date, class_id=upload.class_obj_id),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        absent_student_ids = set(serializer.validated_data['absent_student_ids'])
        name_corrections = serializer.validated_data.get('name_corrections', [])
        roll_corrections = serializer.validated_data.get('roll_corrections', [])
        user_changed_marks = serializer.validated_data.get('user_changed_marks', [])

        logger.info(f"Confirm attendance for upload {upload.id}:")
        logger.info(f"  Absent IDs: {absent_student_ids}")
        logger.info(f"  Name corrections: {len(name_corrections)} items")
        logger.info(f"  Roll corrections: {len(roll_corrections)} items")
        logger.info(f"  User changed marks (implicit feedback): {len(user_changed_marks)} items")
        if user_changed_marks:
            for change in user_changed_marks:
                logger.info(f"    Student {change['student_id']}: AI suggested {change['ai_suggested']} → User confirmed {change['user_confirmed']} (AI confidence: {change['confidence']})")

        # Get all active students in the class
        all_students = Student.objects.filter(
            school=upload.school,
            class_obj=upload.class_obj,
            is_active=True
        )

        # Create attendance records using bulk operations
        student_ids = [s.id for s in all_students]
        existing_records = {
            r.student_id: r
            for r in AttendanceRecord.objects.filter(
                student_id__in=student_ids, date=upload.date
            )
        }

        to_create = []
        to_update = []
        for student in all_students:
            att_status = (
                AttendanceRecord.AttendanceStatus.ABSENT
                if student.id in absent_student_ids
                else AttendanceRecord.AttendanceStatus.PRESENT
            )
            if student.id in existing_records:
                record = existing_records[student.id]
                record.school = upload.school
                record.academic_year = upload.academic_year
                record.status = att_status
                record.source = AttendanceRecord.Source.IMAGE_AI
                record.upload = upload
                to_update.append(record)
            else:
                to_create.append(AttendanceRecord(
                    student=student,
                    date=upload.date,
                    school=upload.school,
                    academic_year=upload.academic_year,
                    status=att_status,
                    source=AttendanceRecord.Source.IMAGE_AI,
                    upload=upload,
                ))

        if to_create:
            AttendanceRecord.objects.bulk_create(to_create)
        if to_update:
            AttendanceRecord.objects.bulk_update(
                to_update, ['school', 'academic_year', 'status', 'source', 'upload']
            )
        created_records = to_update + to_create

        # Update upload status
        upload.status = AttendanceUpload.Status.CONFIRMED
        upload.confirmed_by = request.user
        upload.confirmed_at = timezone.now()
        upload.save()

        # Record corrections for learning loop
        try:
            from .learning_service import LearningService
            learning_service = LearningService(upload.school)
            learning_stats = learning_service.record_corrections(
                upload,
                list(absent_student_ids),
                name_corrections=name_corrections,
                roll_corrections=roll_corrections,
                user_changed_marks=user_changed_marks,  # NEW: implicit feedback from simplified UI
            )
            logger.info(f"Learning feedback recorded: {learning_stats}")
        except Exception as e:
            logger.warning(f"Failed to record learning feedback: {e}")
            learning_stats = {}

        # Trigger WhatsApp notifications for absent students
        if upload.school.get_enabled_module('whatsapp'):
            try:
                from .tasks import send_whatsapp_notifications
                send_whatsapp_notifications.delay(upload.id)
            except Exception as e:
                logger.warning(f"Could not queue WhatsApp notifications: {e}")

        return Response({
            'success': True,
            'message': 'Attendance confirmed successfully.',
            'total_students': len(created_records),
            'absent_count': len(absent_student_ids),
            'present_count': len(created_records) - len(absent_student_ids),
            'learning_stats': learning_stats,
        })

    @action(detail=False, methods=['get'])
    def pending_review(self, request):
        """Get all uploads pending review, including stuck PROCESSING ones."""
        # Auto-recover: mark uploads stuck in PROCESSING for > 5 minutes as FAILED
        stuck_cutoff = timezone.now() - timezone.timedelta(minutes=5)
        stuck = self.get_queryset().filter(
            status=AttendanceUpload.Status.PROCESSING,
            created_at__lt=stuck_cutoff,
        )
        stuck_count = stuck.update(
            status=AttendanceUpload.Status.FAILED,
            error_message='Processing timed out. Click "Reprocess AI" to retry.',
        )
        if stuck_count:
            logger.warning(f"Auto-recovered {stuck_count} stuck uploads")

        # Return REVIEW_REQUIRED + PROCESSING + FAILED (not CONFIRMED)
        queryset = self.get_queryset().exclude(
            status=AttendanceUpload.Status.CONFIRMED
        )
        serializer = AttendanceUploadSerializer(queryset, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def reprocess(self, request, pk=None):
        """
        Manually trigger AI reprocessing for an upload.
        Useful when AI processing failed initially.
        """
        upload = self.get_object()

        if upload.status == AttendanceUpload.Status.CONFIRMED:
            return Response(
                {'error': 'Cannot reprocess a confirmed upload.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        logger.info(f"Reprocessing upload {upload.id}")
        upload.status = AttendanceUpload.Status.PROCESSING
        upload.error_message = ''
        upload.save()

        # Process synchronously
        self._process_upload_sync(upload.id)

        # Refresh from DB
        upload.refresh_from_db()

        return Response({
            'success': True,
            'status': upload.status,
            'matched_count': upload.ai_output_json.get('matched_count', 0) if upload.ai_output_json else 0,
            'error': upload.error_message or None,
        })

    @action(detail=True, methods=['get'])
    def test_image(self, request, pk=None):
        """
        Test if the image URL is accessible.
        Returns image info if successful.
        """
        import requests as req
        from PIL import Image
        from io import BytesIO

        upload = self.get_object()

        try:
            logger.info(f"Testing image access: {upload.image_url}")
            response = req.get(upload.image_url, timeout=30)
            response.raise_for_status()

            # Try to open as image
            img = Image.open(BytesIO(response.content))

            return Response({
                'success': True,
                'url': upload.image_url,
                'size_bytes': len(response.content),
                'dimensions': f"{img.width}x{img.height}",
                'format': img.format,
                'content_type': response.headers.get('content-type'),
            })
        except req.RequestException as e:
            logger.error(f"Image fetch failed: {e}")
            return Response({
                'success': False,
                'url': upload.image_url,
                'error': str(e),
            }, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            logger.error(f"Image test failed: {e}")
            return Response({
                'success': False,
                'url': upload.image_url,
                'error': str(e),
            }, status=status.HTTP_400_BAD_REQUEST)


class AIStatusView(ModuleAccessMixin, APIView):
    """
    Returns the current AI processing configuration and status.
    """
    required_module = 'attendance'
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from django.conf import settings

        # Check vision pipeline settings
        use_vision = getattr(settings, 'USE_VISION_PIPELINE', True)
        vision_provider = getattr(settings, 'VISION_PROVIDER', 'google')

        # Check if required API keys are configured
        google_key = getattr(settings, 'GOOGLE_VISION_API_KEY', '')
        google_creds = getattr(settings, 'GOOGLE_APPLICATION_CREDENTIALS', '')
        groq_key = getattr(settings, 'GROQ_API_KEY', '')
        groq_vision_model = getattr(settings, 'GROQ_VISION_MODEL', 'llama-3.2-11b-vision-preview')

        # Determine if AI is available
        ai_available = False
        provider_status = 'not_configured'
        provider_name = 'None'
        model_name = None

        if use_vision:
            if vision_provider == 'google':
                if google_key or google_creds:
                    ai_available = True
                    provider_status = 'configured'
                    provider_name = 'Google Cloud Vision'
                    model_name = 'DOCUMENT_TEXT_DETECTION'
                else:
                    provider_status = 'missing_credentials'
            else:  # groq
                if groq_key:
                    ai_available = True
                    provider_status = 'configured'
                    provider_name = 'Groq Vision'
                    model_name = groq_vision_model
                else:
                    provider_status = 'missing_credentials'
        else:
            # Legacy Tesseract OCR
            provider_name = 'Tesseract OCR (Legacy)'
            provider_status = 'configured'
            ai_available = True  # Tesseract doesn't need API keys

        return Response({
            'ai_available': ai_available,
            'provider': vision_provider if use_vision else 'tesseract',
            'provider_name': provider_name,
            'model': model_name,
            'status': provider_status,
            'use_vision_pipeline': use_vision,
        })


class AttendanceRecordViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ReadOnlyModelViewSet):
    required_module = 'attendance'
    """
    ViewSet for viewing attendance records.
    """
    queryset = AttendanceRecord.objects.all()
    serializer_class = AttendanceRecordSerializer
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get_queryset(self):
        queryset = AttendanceRecord.objects.select_related(
            'school', 'student', 'student__class_obj', 'upload', 'academic_year'
        )

        # Filter by active school (works for all users including super admin)
        active_school_id = ensure_tenant_school_id(self.request)
        if active_school_id:
            queryset = queryset.filter(school_id=active_school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        # Filter by school if provided (overrides active school)
        school_id = self.request.query_params.get('school_id')
        if school_id:
            queryset = queryset.filter(school_id=school_id)

        # Resolve scope first so class filtering can remain year-consistent.
        academic_year_id = self.request.query_params.get('academic_year')
        class_id = self.request.query_params.get('class_id')
        session_class_obj_id, session_class_year_id = _resolve_session_class_filter(self.request)
        if session_class_obj_id:
            class_id = session_class_obj_id
        if not academic_year_id and session_class_year_id:
            academic_year_id = session_class_year_id
        if academic_year_id and session_class_year_id and str(academic_year_id) != str(session_class_year_id):
            return queryset.none()

        if class_id:
            if academic_year_id:
                queryset = queryset.filter(
                    student__enrollments__academic_year_id=academic_year_id,
                    student__enrollments__class_obj_id=class_id,
                    student__enrollments__is_active=True,
                )
            else:
                queryset = queryset.filter(student__class_obj_id=class_id)

        # Filter by date (exact or range)
        date = self.request.query_params.get('date')
        if date:
            queryset = queryset.filter(date=date)

        date_from = self.request.query_params.get('date_from')
        if date_from:
            queryset = queryset.filter(date__gte=date_from)

        date_to = self.request.query_params.get('date_to')
        if date_to:
            queryset = queryset.filter(date__lte=date_to)

        # Filter by academic year
        if academic_year_id:
            queryset = queryset.filter(academic_year_id=academic_year_id)

        # Filter by status
        record_status = self.request.query_params.get('status')
        if record_status:
            queryset = queryset.filter(status=record_status)

        return queryset.order_by('-date', 'student__class_obj', 'student__roll_number')

    @action(detail=False, methods=['get'])
    def register_data(self, request):
        """
        Lightweight endpoint for the register page.
        Returns only (student, date, status) using .values() — no serializer overhead,
        no unnecessary JOINs, no pagination COUNT(*) query.
        """
        class_id = request.query_params.get('class_id')
        session_class_obj_id, session_class_year_id = _resolve_session_class_filter(request)
        if session_class_obj_id:
            class_id = session_class_obj_id
        date_from = request.query_params.get('date_from')
        date_to = request.query_params.get('date_to')
        academic_year_id = request.query_params.get('academic_year')
        if not academic_year_id and session_class_year_id:
            academic_year_id = session_class_year_id

        if academic_year_id and session_class_year_id and str(academic_year_id) != str(session_class_year_id):
            return Response([])

        if not class_id or not date_from or not date_to:
            return Response(
                {'detail': 'class_id (or session_class_id), date_from, and date_to are required.'},
                status=400,
            )

        active_school_id = ensure_tenant_school_id(request)
        if not active_school_id:
            return Response({'detail': 'School context required.'}, status=400)

        records = (
            AttendanceRecord.objects
            .filter(
                school_id=active_school_id,
                date__gte=date_from,
                date__lte=date_to,
            )
            .values('student_id', 'date', 'status')
        )
        if academic_year_id:
            records = records.filter(
                student__enrollments__academic_year_id=academic_year_id,
                student__enrollments__class_obj_id=class_id,
                student__enrollments__is_active=True,
                academic_year_id=academic_year_id,
            )
        else:
            records = records.filter(student__class_obj_id=class_id)
        return Response(list(records))

    @action(detail=False, methods=['get'])
    def daily_report(self, request):
        """Get daily attendance report."""
        date_param = request.query_params.get('date')
        date = parse_date(date_param) if date_param else timezone.now().date()
        if not date:
            return Response({'error': 'Invalid date format. Use YYYY-MM-DD.'}, status=400)
        school_id = request.query_params.get('school_id') or ensure_tenant_school_id(request) or request.user.school_id
        academic_year = request.query_params.get('academic_year')

        if not school_id:
            return Response({'error': 'school_id is required'}, status=400)

        # Get counts — session-aware when academic_year is provided
        students_qs = Student.objects.filter(school_id=school_id, is_active=True)
        if academic_year:
            students_qs = students_qs.filter(
                enrollments__academic_year_id=academic_year,
                enrollments__is_active=True,
            )
        total = students_qs.count()
        records = AttendanceRecord.objects.filter(school_id=school_id, date=date)

        absent_records = records.filter(status=AttendanceRecord.AttendanceStatus.ABSENT)

        is_off_day = is_off_day_for_date(school_id, date)
        return Response({
            'date': date,
            'is_off_day': is_off_day,
            'off_day_types': off_day_types_for_date(school_id, date),
            'total_students': total,
            'present_count': records.filter(status=AttendanceRecord.AttendanceStatus.PRESENT).count(),
            'absent_count': absent_records.count(),
            'absent_students': AttendanceRecordSerializer(absent_records, many=True).data,
        })

    @action(detail=False, methods=['get'])
    def chronic_absentees(self, request):
        """Get students with high absence rates."""
        school_id = request.query_params.get('school_id') or ensure_tenant_school_id(request) or request.user.school_id
        days = int(request.query_params.get('days', 30))
        threshold = float(request.query_params.get('threshold', 20))  # % absent

        if not school_id:
            return Response({'error': 'school_id is required'}, status=400)

        date_from = timezone.now().date() - timezone.timedelta(days=days)

        students_qs = Student.objects.filter(
            school_id=school_id,
            is_active=True,
        ).select_related('class_obj')
        student_map = {student.id: student for student in students_qs}

        attendance_rows = AttendanceRecord.objects.filter(
            school_id=school_id,
            date__gte=date_from,
            student_id__in=student_map.keys(),
        ).values('student_id', 'date', 'status')

        class_off_dates_cache = {}
        stats = {sid: {'absent_count': 0, 'total_days': 0} for sid in student_map.keys()}

        for row in attendance_rows:
            student = student_map.get(row['student_id'])
            if not student:
                continue

            class_id = getattr(student, 'class_obj_id', None)
            if class_id not in class_off_dates_cache:
                class_off_dates_cache[class_id] = build_off_day_date_set(
                    school_id=school_id,
                    date_from=date_from,
                    date_to=timezone.now().date(),
                    class_id=class_id,
                )

            if row['date'] in class_off_dates_cache[class_id]:
                continue

            stats[row['student_id']]['total_days'] += 1
            if row['status'] == AttendanceRecord.AttendanceStatus.ABSENT:
                stats[row['student_id']]['absent_count'] += 1

        # Calculate percentage and filter
        chronic = []
        for student_id, summary in stats.items():
            total_days = summary['total_days']
            absent_count = summary['absent_count']
            student = student_map.get(student_id)
            if total_days > 0 and student:
                percentage = (absent_count / total_days) * 100
                if percentage >= threshold:
                    chronic.append({
                        'student': {
                            'id': student.id,
                            'name': student.name,
                            'roll_number': student.roll_number,
                            'class_name': student.class_obj.name,
                        },
                        'absent_count': absent_count,
                        'total_days': total_days,
                        'absence_percentage': round(percentage, 1),
                    })

        # Sort by absence percentage descending
        chronic.sort(key=lambda x: x['absence_percentage'], reverse=True)

        return Response({
            'period_days': days,
            'threshold_percentage': threshold,
            'chronic_absentees': chronic,
        })

    @action(detail=False, methods=['get'])
    def accuracy_stats(self, request):
        """
        Get AI accuracy statistics for the current school.
        Shows how often AI predictions match human confirmations.
        """
        from .learning_service import LearningService

        school_id = request.query_params.get('school_id') or ensure_tenant_school_id(request) or request.user.school_id
        if not school_id:
            return Response({'error': 'school_id is required'}, status=400)

        try:
            from schools.models import School
            school = School.objects.get(id=school_id)
        except School.DoesNotExist:
            return Response({'error': 'School not found'}, status=404)

        days = int(request.query_params.get('days', 30))

        learning_service = LearningService(school)
        stats = learning_service.get_school_accuracy_stats(days=days)
        trend = learning_service.get_accuracy_trend(weeks=4)
        common_errors = learning_service.get_common_ocr_errors(limit=10)

        return Response({
            'school_name': school.name,
            'period_stats': stats,
            'weekly_trend': trend,
            'common_ocr_errors': common_errors,
        })

    @action(detail=False, methods=['get'])
    def mapping_suggestions(self, request):
        """
        Get suggestions for improving mark mappings based on OCR errors.
        """
        from .learning_service import LearningService

        school_id = request.query_params.get('school_id') or ensure_tenant_school_id(request) or request.user.school_id
        if not school_id:
            return Response({'error': 'school_id is required'}, status=400)

        try:
            from schools.models import School
            school = School.objects.get(id=school_id)
        except School.DoesNotExist:
            return Response({'error': 'School not found'}, status=404)

        learning_service = LearningService(school)
        suggestions = learning_service.suggest_mark_mapping_updates()

        return Response({
            'school_name': school.name,
            **suggestions
        })

    @action(detail=False, methods=['get'])
    def threshold_status(self, request):
        """
        Get current AI threshold configuration for the school.
        Shows per-school thresholds, auto-tune status, and recent tune history.
        """
        from .threshold_service import ThresholdService

        school_id = request.query_params.get('school_id') or ensure_tenant_school_id(request) or request.user.school_id
        if not school_id:
            return Response({'error': 'school_id is required'}, status=400)

        try:
            from schools.models import School
            school = School.objects.get(id=school_id)
        except School.DoesNotExist:
            return Response({'error': 'School not found'}, status=404)

        ts = ThresholdService(school)
        ai_config = school.ai_config or {}

        return Response({
            'school_name': school.name,
            'thresholds': ts.get_all(),
            'defaults': ThresholdService.DEFAULTS,
            'auto_tune_enabled': ai_config.get('auto_tune_enabled', False),
            'last_tuned_at': ai_config.get('last_tuned_at'),
            'tune_history': ai_config.get('tune_history', [])[-5:],
        })

    @action(detail=False, methods=['post'], permission_classes=[IsAuthenticated, IsSchoolAdmin])
    def tune_thresholds(self, request):
        """
        Update AI threshold settings for the school.

        Accepts:
        - auto_tune_enabled (bool): Toggle weekly auto-tuning
        - thresholds (dict): Manual threshold overrides (partial updates allowed)
        """
        school_id = request.data.get('school_id') or ensure_tenant_school_id(request) or request.user.school_id
        if not school_id:
            return Response({'error': 'school_id is required'}, status=400)

        try:
            from schools.models import School
            school = School.objects.get(id=school_id)
        except School.DoesNotExist:
            return Response({'error': 'School not found'}, status=404)

        ai_config = school.ai_config or {}

        # Toggle auto-tune
        if 'auto_tune_enabled' in request.data:
            ai_config['auto_tune_enabled'] = bool(request.data['auto_tune_enabled'])

        # Update thresholds (partial update)
        if 'thresholds' in request.data:
            from .threshold_service import ThresholdService
            current = ai_config.get('thresholds', {})
            for key, value in request.data['thresholds'].items():
                if key in ThresholdService.DEFAULTS:
                    try:
                        current[key] = float(value)
                    except (ValueError, TypeError):
                        return Response(
                            {'error': f'Invalid value for threshold {key}'},
                            status=400,
                        )
            ai_config['thresholds'] = current

        school.ai_config = ai_config
        school.save(update_fields=['ai_config'])

        return Response({
            'success': True,
            'message': 'Threshold settings updated.',
            'auto_tune_enabled': ai_config.get('auto_tune_enabled', False),
            'thresholds': ai_config.get('thresholds', {}),
        })

    @action(detail=False, methods=['get'])
    def drift_history(self, request):
        """
        Get accuracy drift history for the school.
        Returns daily accuracy snapshots with drift event markers.
        """
        from .models import AccuracySnapshot

        school_id = request.query_params.get('school_id') or ensure_tenant_school_id(request) or request.user.school_id
        if not school_id:
            return Response({'error': 'school_id is required'}, status=400)

        days = int(request.query_params.get('days', 30))
        since = timezone.now() - timezone.timedelta(days=days)

        snapshots = AccuracySnapshot.objects.filter(
            school_id=school_id,
            date__gte=since.date(),
        ).order_by('date')

        active_drift = snapshots.filter(drift_detected=True).order_by('-date').first()

        return Response({
            'snapshots': [
                {
                    'date': s.date,
                    'accuracy': s.accuracy,
                    'total_predictions': s.total_predictions,
                    'total_corrections': s.total_corrections,
                    'false_positives': s.false_positives,
                    'false_negatives': s.false_negatives,
                    'drift_detected': s.drift_detected,
                    'drift_details': s.drift_details,
                }
                for s in snapshots
            ],
            'active_drift': {
                'detected': active_drift is not None,
                'date': active_drift.date if active_drift else None,
                'details': active_drift.drift_details if active_drift else None,
            } if active_drift else {'detected': False},
            'days': days,
        })

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated, CanManualAttendance])
    def my_classes(self, request):
        """Return classes available for manual attendance entry (role-aware)."""
        from students.models import Class

        school_id = ensure_tenant_school_id(request) or request.user.school_id
        if not school_id:
            return Response({'detail': 'No school context.'}, status=status.HTTP_400_BAD_REQUEST)

        role = get_effective_role(request)
        if role in ADMIN_ROLES:
            classes = Class.objects.filter(school_id=school_id, is_active=True)
        elif role == 'TEACHER':
            # Use master class IDs for the class list (still shows assigned master classes)
            class_ids = get_teacher_class_scope(request, school_id=school_id)
            classes = Class.objects.filter(id__in=class_ids, is_active=True)
        else:
            classes = Class.objects.none()

        data = [{'id': c.id, 'name': c.name, 'section': c.section, 'grade_level': c.grade_level} for c in classes.order_by('grade_level', 'section', 'name')]
        return Response(data)

    @action(detail=False, methods=['post'], permission_classes=[IsAuthenticated, CanManualAttendance])
    def bulk_entry(self, request):
        """
        Manually enter/update attendance for a class on a date.

        POST /api/attendance/records/bulk_entry/
        Body: {class_id|session_class_id, date, entries: [{student_id, status}, ...]}
        Returns: {created, updated, errors, message}
        """
        from .serializers import AttendanceBulkEntrySerializer
        from students.models import Class
        from academic_sessions.models import AcademicYear, SessionClass, StudentEnrollment

        serializer = AttendanceBulkEntrySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        school_id = ensure_tenant_school_id(request) or request.user.school_id
        if not school_id:
            return Response({'detail': 'No school context.'}, status=status.HTTP_400_BAD_REQUEST)

        class_id = serializer.validated_data.get('class_id')
        session_class_id = serializer.validated_data.get('session_class_id')
        requested_academic_year = serializer.validated_data.get('academic_year')
        date = serializer.validated_data['date']
        entries = serializer.validated_data['entries']

        session_class = None
        if session_class_id:
            session_class = SessionClass.objects.filter(
                id=session_class_id,
                school_id=school_id,
                is_active=True,
            ).first()
            if not session_class or not session_class.class_obj_id:
                return Response(
                    {'detail': 'Session class not found or not linked to a master class.'},
                    status=status.HTTP_404_NOT_FOUND,
                )
            class_id = session_class.class_obj_id

        # Validate class belongs to school
        try:
            class_obj = Class.objects.get(pk=class_id, school_id=school_id, is_active=True)
        except Class.DoesNotExist:
            return Response(
                {'detail': 'Class not found or does not belong to this school.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Teacher: verify class-teacher assignment (section-scoped)
        role = get_effective_role(request)
        if role == 'TEACHER':
            session_class_ids = get_teacher_session_class_scope(request, school_id=school_id)
            if session_class and session_class_ids:
                # Session class provided — verify teacher is assigned to this specific section
                if session_class.id not in session_class_ids:
                    return Response(
                        {'detail': 'You are not assigned as class teacher for this class section.'},
                        status=status.HTTP_403_FORBIDDEN,
                    )
            else:
                # Fall back to master class scope
                class_scope = get_teacher_class_scope(request, school_id=school_id)
                if class_id not in class_scope:
                    return Response(
                        {'detail': 'You are not assigned as class teacher for this class.'},
                        status=status.HTTP_403_FORBIDDEN,
                    )

        # Resolve academic year: session class -> requested year -> current year
        academic_year = None
        if session_class:
            academic_year = session_class.academic_year
            if requested_academic_year and int(requested_academic_year) != academic_year.id:
                return Response(
                    {'detail': 'academic_year does not match selected session_class_id.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        elif requested_academic_year:
            academic_year = AcademicYear.objects.filter(
                id=requested_academic_year,
                school_id=school_id,
                is_active=True,
            ).first()
            if not academic_year:
                return Response(
                    {'detail': 'Invalid academic_year for this school.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            academic_year = AcademicYear.objects.filter(
                school_id=school_id,
                is_current=True,
                is_active=True,
            ).first()

        # Validate all student_ids belong to this class and academic year (when available)
        if academic_year:
            valid_student_ids = set(
                StudentEnrollment.objects.filter(
                    school_id=school_id,
                    academic_year=academic_year,
                    class_obj_id=class_id,
                    is_active=True,
                ).values_list('student_id', flat=True)
            )
        else:
            valid_student_ids = set(
                Student.objects.filter(
                    school_id=school_id,
                    class_obj_id=class_id,
                    is_active=True,
                ).values_list('id', flat=True)
            )

        created = 0
        updated = 0
        errors = []

        for entry in entries:
            student_id = entry['student_id']
            att_status = entry['status']

            if student_id not in valid_student_ids:
                errors.append({'student_id': student_id, 'error': 'Student not found in this class.'})
                continue

            try:
                record, was_created = AttendanceRecord.objects.update_or_create(
                    student_id=student_id,
                    date=date,
                    defaults={
                        'school_id': school_id,
                        'academic_year': academic_year,
                        'status': att_status,
                        'source': AttendanceRecord.Source.MANUAL,
                        'upload': None,
                    },
                )
                if was_created:
                    created += 1
                else:
                    updated += 1
            except Exception as e:
                errors.append({'student_id': student_id, 'error': str(e)})

        return Response({
            'created': created,
            'updated': updated,
            'errors': errors,
            'message': f'{created + updated} attendance records saved.',
        })


class AttendanceAnomalyViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ReadOnlyModelViewSet):
    """
    ViewSet for viewing and resolving attendance anomalies.

    GET  /api/attendance/anomalies/       - List anomalies (filterable)
    GET  /api/attendance/anomalies/{id}/  - Detail
    POST /api/attendance/anomalies/{id}/resolve/ - Mark as resolved
    """
    required_module = 'attendance'
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get_queryset(self):
        from .models import AttendanceAnomaly

        queryset = AttendanceAnomaly.objects.select_related(
            'school', 'class_obj', 'student', 'resolved_by',
        )

        active_school_id = ensure_tenant_school_id(self.request)
        if active_school_id:
            queryset = queryset.filter(school_id=active_school_id)
        elif not self.request.user.is_super_admin:
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        # Filters
        anomaly_type = self.request.query_params.get('anomaly_type')
        if anomaly_type:
            queryset = queryset.filter(anomaly_type=anomaly_type)

        severity = self.request.query_params.get('severity')
        if severity:
            queryset = queryset.filter(severity=severity)

        is_resolved = self.request.query_params.get('is_resolved')
        if is_resolved is not None:
            queryset = queryset.filter(is_resolved=is_resolved.lower() == 'true')

        return queryset.order_by('-date', '-severity')

    def get_serializer_class(self):
        from .serializers import AttendanceAnomalySerializer
        return AttendanceAnomalySerializer

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated, IsSchoolAdmin])
    def resolve(self, request, pk=None):
        """Mark an anomaly as resolved with notes."""
        from .models import AttendanceAnomaly

        anomaly = self.get_object()
        if anomaly.is_resolved:
            return Response({'error': 'Already resolved'}, status=400)

        anomaly.is_resolved = True
        anomaly.resolved_by = request.user
        anomaly.resolved_at = timezone.now()
        anomaly.resolution_notes = request.data.get('notes', '')
        anomaly.save(update_fields=['is_resolved', 'resolved_by', 'resolved_at', 'resolution_notes'])

        from .serializers import AttendanceAnomalySerializer
        return Response(AttendanceAnomalySerializer(anomaly).data)
