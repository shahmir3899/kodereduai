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
from django.db.models import Count, Q

from core.permissions import IsSchoolAdmin, HasSchoolAccess, CanConfirmAttendance, CanManualAttendance, ModuleAccessMixin, get_effective_role, ADMIN_ROLES
from core.mixins import TenantQuerySetMixin, ensure_tenant_schools, ensure_tenant_school_id
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


class ImageUploadView(ModuleAccessMixin, APIView):
    """
    Upload attendance images to Supabase storage.
    """
    required_module = 'attendance'
    permission_classes = [IsAuthenticated, IsSchoolAdmin]
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
    permission_classes = [IsAuthenticated, IsSchoolAdmin, HasSchoolAccess]

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
            'school', 'class_obj', 'created_by', 'confirmed_by'
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

        # Filter by class
        class_id = self.request.query_params.get('class_id')
        if class_id:
            queryset = queryset.filter(class_obj_id=class_id)

        # Filter by status
        upload_status = self.request.query_params.get('status')
        if upload_status:
            queryset = queryset.filter(status=upload_status)

        # Filter by academic year
        academic_year_id = self.request.query_params.get('academic_year')
        if academic_year_id:
            queryset = queryset.filter(academic_year_id=academic_year_id)

        # Filter by date range
        date_from = self.request.query_params.get('date_from')
        date_to = self.request.query_params.get('date_to')
        if date_from:
            queryset = queryset.filter(date__gte=date_from)
        if date_to:
            queryset = queryset.filter(date__lte=date_to)

        return queryset.order_by('-created_at')

    def perform_create(self, serializer):
        """Create upload and trigger processing task."""
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
            'school', 'student', 'student__class_obj', 'upload'
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

        # Filter by class
        class_id = self.request.query_params.get('class_id')
        if class_id:
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
        academic_year_id = self.request.query_params.get('academic_year')
        if academic_year_id:
            queryset = queryset.filter(academic_year_id=academic_year_id)

        # Filter by status
        record_status = self.request.query_params.get('status')
        if record_status:
            queryset = queryset.filter(status=record_status)

        return queryset.order_by('-date', 'student__class_obj', 'student__roll_number')

    @action(detail=False, methods=['get'])
    def daily_report(self, request):
        """Get daily attendance report."""
        date = request.query_params.get('date', timezone.now().date())
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

        return Response({
            'date': date,
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

        # Get absence counts per student
        from django.db.models import Count, F
        from django.db.models.functions import Cast
        from django.db.models import FloatField

        students = Student.objects.filter(
            school_id=school_id,
            is_active=True
        ).annotate(
            absent_count=Count(
                'attendance_records',
                filter=Q(
                    attendance_records__date__gte=date_from,
                    attendance_records__status=AttendanceRecord.AttendanceStatus.ABSENT
                )
            ),
            total_days=Count(
                'attendance_records',
                filter=Q(attendance_records__date__gte=date_from)
            )
        ).filter(
            total_days__gt=0
        )

        # Calculate percentage and filter
        chronic = []
        for student in students:
            if student.total_days > 0:
                percentage = (student.absent_count / student.total_days) * 100
                if percentage >= threshold:
                    chronic.append({
                        'student': {
                            'id': student.id,
                            'name': student.name,
                            'roll_number': student.roll_number,
                            'class_name': student.class_obj.name,
                        },
                        'absent_count': student.absent_count,
                        'total_days': student.total_days,
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
            from academics.models import ClassSubject
            class_ids = ClassSubject.objects.filter(
                school_id=school_id,
                teacher__user=request.user,
                is_active=True,
            ).values_list('class_obj_id', flat=True).distinct()
            classes = Class.objects.filter(id__in=class_ids, is_active=True)
        else:
            classes = Class.objects.none()

        data = [{'id': c.id, 'name': c.name} for c in classes.order_by('name')]
        return Response(data)

    @action(detail=False, methods=['post'], permission_classes=[IsAuthenticated, CanManualAttendance])
    def bulk_entry(self, request):
        """
        Manually enter/update attendance for a class on a date.

        POST /api/attendance/records/bulk_entry/
        Body: {class_id, date, entries: [{student_id, status}, ...]}
        Returns: {created, updated, errors, message}
        """
        from .serializers import AttendanceBulkEntrySerializer
        from students.models import Class
        from academic_sessions.models import AcademicYear

        serializer = AttendanceBulkEntrySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        school_id = ensure_tenant_school_id(request) or request.user.school_id
        if not school_id:
            return Response({'detail': 'No school context.'}, status=status.HTTP_400_BAD_REQUEST)

        class_id = serializer.validated_data['class_id']
        date = serializer.validated_data['date']
        entries = serializer.validated_data['entries']

        # Validate class belongs to school
        try:
            class_obj = Class.objects.get(pk=class_id, school_id=school_id, is_active=True)
        except Class.DoesNotExist:
            return Response(
                {'detail': 'Class not found or does not belong to this school.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Teacher: verify class assignment via ClassSubject
        role = get_effective_role(request)
        if role == 'TEACHER':
            from academics.models import ClassSubject
            has_assignment = ClassSubject.objects.filter(
                school_id=school_id,
                class_obj_id=class_id,
                teacher__user=request.user,
                is_active=True,
            ).exists()
            if not has_assignment:
                return Response(
                    {'detail': 'You are not assigned to this class.'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        # Auto-resolve academic year
        academic_year = AcademicYear.objects.filter(
            school_id=school_id, is_current=True, is_active=True,
        ).first()

        # Validate all student_ids belong to this class
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
