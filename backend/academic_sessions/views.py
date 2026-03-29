from django.db.models import Count, Q
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.mixins import TenantQuerySetMixin, ensure_tenant_school_id
from core.permissions import IsSchoolAdminOrReadOnly, HasSchoolAccess

from .models import AcademicYear, Term, StudentEnrollment
from .serializers import (
    AcademicYearSerializer,
    AcademicYearCreateSerializer,
    TermSerializer,
    TermCreateSerializer,
    StudentEnrollmentSerializer,
    StudentEnrollmentCreateSerializer,
    BulkPromoteSerializer,
    PromotionTargetApplySerializer,
    PromotionTargetPreviewSerializer,
)


def _resolve_school_id(request):
    school_id = ensure_tenant_school_id(request)
    if school_id:
        return school_id
    sid = (
        request.query_params.get('school_id')
        or request.data.get('school_id')
        or request.data.get('school')
    )
    if sid:
        return int(sid)
    if request.user.school_id:
        return request.user.school_id
    return None


class AcademicYearViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    queryset = AcademicYear.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]


    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return AcademicYearCreateSerializer
        return AcademicYearSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['school_id'] = _resolve_school_id(self.request)
        return ctx

    def get_queryset(self):
        qs = super().get_queryset().select_related('school').annotate(
            terms_count=Count('terms', distinct=True),
            enrollment_count=Count('enrollments', distinct=True),
        ).order_by('-start_date')
        return qs

    @action(detail=True, methods=['post'])
    def set_current(self, request, pk=None):
        year = self.get_object()
        # Unset any other current year for this school first
        AcademicYear.objects.filter(
            school_id=year.school_id, is_current=True,
        ).exclude(pk=year.pk).update(is_current=False)
        year.is_current = True
        year.save()
        return Response(AcademicYearSerializer(year).data)

    @action(detail=False, methods=['get'])
    def current(self, request):
        """Return the current academic year for the active school."""
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response(
                {'detail': 'No school context found.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        year = AcademicYear.objects.filter(
            school_id=school_id, is_current=True,
        ).select_related('school').first()
        if not year:
            return Response(
                {'detail': 'No current academic year set for this school.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        data = AcademicYearSerializer(year).data
        # Include terms for the current year
        terms = Term.objects.filter(
            academic_year=year,
        ).order_by('order')
        from .serializers import TermSerializer
        data['terms'] = TermSerializer(terms, many=True).data
        # Find current term based on today's date
        from datetime import date
        today = date.today()
        current_term = terms.filter(
            start_date__lte=today, end_date__gte=today,
        ).first()
        data['current_term'] = TermSerializer(current_term).data if current_term else None
        return Response(data)

    @action(detail=True, methods=['get'])
    def summary(self, request, pk=None):
        year = self.get_object()
        return Response({
            'id': year.id,
            'name': year.name,
            'terms_count': year.terms.count(),
            'enrollment_count': year.enrollments.count(),
            'classes_count': year.enrollments.values('class_obj').distinct().count(),
        })


class TermViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    queryset = Term.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]


    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return TermCreateSerializer
        return TermSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['school_id'] = _resolve_school_id(self.request)
        return ctx

    def get_queryset(self):
        qs = super().get_queryset().select_related('school', 'academic_year')
        academic_year = self.request.query_params.get('academic_year')
        if academic_year:
            qs = qs.filter(academic_year_id=academic_year)
        return qs


class StudentEnrollmentViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    queryset = StudentEnrollment.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]


    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return StudentEnrollmentCreateSerializer
        return StudentEnrollmentSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['school_id'] = _resolve_school_id(self.request)
        return ctx

    def get_queryset(self):
        qs = super().get_queryset().select_related(
            'school', 'student', 'academic_year', 'class_obj',
        )
        academic_year = self.request.query_params.get('academic_year')
        if academic_year:
            qs = qs.filter(academic_year_id=academic_year)
        class_id = self.request.query_params.get('class_id')
        if class_id:
            qs = qs.filter(class_obj_id=class_id)
        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs

    @staticmethod
    def _derive_next_class_name(source_name):
        import re

        match = re.match(r'^(.*?)(\d+)([^\d]*)$', source_name or '')
        if not match:
            return ''

        prefix, num, suffix = match.group(1), match.group(2), match.group(3)
        return f"{prefix}{int(num) + 1}{suffix}".strip()

    @staticmethod
    def _class_label(class_obj):
        if class_obj.section:
            return f"{class_obj.name} - {class_obj.section}"
        return class_obj.name

    def _compute_promotion_target_plan(self, school_id, source_class):
        from students.models import Class

        next_grade_level = source_class.grade_level + 1
        next_grade_classes = list(Class.objects.filter(
            school_id=school_id,
            grade_level=next_grade_level,
        ).order_by('section', 'name', 'id'))

        source_section = (source_class.section or '').strip().lower()
        status = 'missing'
        reason = 'No matching target class found.'
        suggested_name = ''
        suggested_section = source_class.section or ''
        existing_class = None

        if source_section:
            same_section_matches = [
                c for c in next_grade_classes
                if (c.section or '').strip().lower() == source_section
            ]
            if len(same_section_matches) == 1:
                existing_class = same_section_matches[0]
                if existing_class.is_active:
                    status = 'exists_active'
                    reason = 'Matching same-section target exists and is active.'
                else:
                    status = 'exists_inactive'
                    reason = 'Matching same-section target exists but is inactive and should be reactivated.'
            elif len(same_section_matches) > 1:
                status = 'ambiguous'
                reason = 'Multiple same-section target classes found. Manual selection required.'
            else:
                suggested_name = self._derive_next_class_name(source_class.name)
                if suggested_name:
                    reason = 'Missing same-section target class; safe to create.'
                else:
                    status = 'ambiguous'
                    reason = 'Unable to derive next class name automatically. Manual class setup required.'
        else:
            if len(next_grade_classes) == 1:
                existing_class = next_grade_classes[0]
                if existing_class.is_active:
                    status = 'exists_active'
                    reason = 'Single next-grade target exists and is active.'
                else:
                    status = 'exists_inactive'
                    reason = 'Single next-grade target exists but is inactive and should be reactivated.'
            elif len(next_grade_classes) > 1:
                status = 'ambiguous'
                reason = 'Multiple next-grade targets exist for a no-section source class. Manual selection required.'
            else:
                suggested_name = self._derive_next_class_name(source_class.name)
                if suggested_name:
                    reason = 'Missing next-grade target class; safe to create.'
                else:
                    status = 'ambiguous'
                    reason = 'Unable to derive next class name automatically. Manual class setup required.'

        return {
            'status': status,
            'reason': reason,
            'next_grade_level': next_grade_level,
            'suggested_name': suggested_name,
            'suggested_section': suggested_section,
            'existing_class': existing_class,
            'candidates': next_grade_classes,
        }

    @action(detail=False, methods=['post'], url_path='promotion-targets-preview')
    def promotion_targets_preview(self, request):
        """Preview safe target-class mapping for promotion (exists/create/reactivate/ambiguous)."""
        school_id = _resolve_school_id(request)
        serializer = PromotionTargetPreviewSerializer(
            data=request.data,
            context={'school_id': school_id},
        )
        serializer.is_valid(raise_exception=True)

        source_year = serializer.validated_data['source_academic_year']
        target_year = serializer.validated_data['target_academic_year']
        source_class = serializer.validated_data['source_class']

        plan = self._compute_promotion_target_plan(school_id, source_class)
        status_value = plan['status']
        reason = plan['reason']
        next_grade_level = plan['next_grade_level']
        suggested_name = plan['suggested_name']
        suggested_section = plan['suggested_section']
        existing_class = plan['existing_class']
        next_grade_classes = plan['candidates']

        can_auto_create = status_value == 'missing' and bool(suggested_name)
        can_reactivate = status_value == 'exists_inactive'

        response_data = {
            'source_academic_year': {'id': source_year.id, 'name': source_year.name},
            'target_academic_year': {'id': target_year.id, 'name': target_year.name},
            'source_class': {
                'id': source_class.id,
                'name': source_class.name,
                'section': source_class.section,
                'grade_level': source_class.grade_level,
                'label': self._class_label(source_class),
            },
            'target_plan': {
                'status': status_value,
                'reason': reason,
                'next_grade_level': next_grade_level,
                'existing_class': (
                    {
                        'id': existing_class.id,
                        'name': existing_class.name,
                        'section': existing_class.section,
                        'grade_level': existing_class.grade_level,
                        'label': self._class_label(existing_class),
                        'is_active': existing_class.is_active,
                    }
                    if existing_class else None
                ),
                'proposed_class': (
                    {
                        'name': suggested_name,
                        'section': suggested_section,
                        'grade_level': next_grade_level,
                        'label': f"{suggested_name}{f' - {suggested_section}' if suggested_section else ''}",
                    }
                    if can_auto_create else None
                ),
                'can_auto_create': can_auto_create,
                'can_reactivate': can_reactivate,
                'candidates': [
                    {
                        'id': c.id,
                        'name': c.name,
                        'section': c.section,
                        'grade_level': c.grade_level,
                        'label': self._class_label(c),
                        'is_active': c.is_active,
                    }
                    for c in next_grade_classes
                ],
            },
        }

        return Response(response_data)

    @action(detail=False, methods=['post'], url_path='promotion-targets-apply')
    def promotion_targets_apply(self, request):
        """Apply safe target-class plan (create/reactivate) and return resolved target class."""
        school_id = _resolve_school_id(request)
        serializer = PromotionTargetApplySerializer(
            data=request.data,
            context={'school_id': school_id},
        )
        serializer.is_valid(raise_exception=True)

        source_year = serializer.validated_data['source_academic_year']
        target_year = serializer.validated_data['target_academic_year']
        source_class = serializer.validated_data['source_class']
        create_if_missing = serializer.validated_data['create_if_missing']
        reactivate_if_inactive = serializer.validated_data['reactivate_if_inactive']

        plan = self._compute_promotion_target_plan(school_id, source_class)
        status_value = plan['status']
        target_class = plan['existing_class']
        action_taken = 'none'

        if status_value == 'ambiguous':
            return Response({
                'detail': plan['reason'],
                'status': status_value,
                'candidates': [
                    {
                        'id': c.id,
                        'name': c.name,
                        'section': c.section,
                        'grade_level': c.grade_level,
                        'label': self._class_label(c),
                        'is_active': c.is_active,
                    }
                    for c in plan['candidates']
                ],
            }, status=status.HTTP_400_BAD_REQUEST)

        if status_value == 'exists_inactive':
            if not reactivate_if_inactive:
                return Response(
                    {'detail': 'Target class exists but is inactive and reactivation is disabled.', 'status': status_value},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            target_class.is_active = True
            target_class.save(update_fields=['is_active', 'updated_at'])
            action_taken = 'reactivated'

        if status_value == 'missing':
            if not create_if_missing:
                return Response(
                    {'detail': 'Target class is missing and creation is disabled.', 'status': status_value},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            from students.models import Class
            if not plan['suggested_name']:
                return Response(
                    {'detail': 'Unable to derive target class name for auto-create.', 'status': status_value},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            target_class, created = Class.objects.get_or_create(
                school_id=school_id,
                name=plan['suggested_name'],
                section=plan['suggested_section'],
                defaults={'grade_level': plan['next_grade_level'], 'is_active': True},
            )
            if not created and not target_class.is_active:
                target_class.is_active = True
                target_class.save(update_fields=['is_active', 'updated_at'])
                action_taken = 'reactivated'
            else:
                action_taken = 'created' if created else 'reused'

        if target_class is None:
            return Response(
                {'detail': 'Target class could not be resolved.', 'status': status_value},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response({
            'source_academic_year': {'id': source_year.id, 'name': source_year.name},
            'target_academic_year': {'id': target_year.id, 'name': target_year.name},
            'source_class': {
                'id': source_class.id,
                'name': source_class.name,
                'section': source_class.section,
                'grade_level': source_class.grade_level,
                'label': self._class_label(source_class),
            },
            'target_class': {
                'id': target_class.id,
                'name': target_class.name,
                'section': target_class.section,
                'grade_level': target_class.grade_level,
                'label': self._class_label(target_class),
                'is_active': target_class.is_active,
            },
            'status': status_value,
            'action_taken': action_taken,
        })

    @action(detail=False, methods=['get'])
    def by_class(self, request):
        class_id = request.query_params.get('class_id')
        academic_year_id = request.query_params.get('academic_year_id')
        if not class_id or not academic_year_id:
            return Response(
                {'detail': 'class_id and academic_year_id params required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        qs = self.get_queryset().filter(
            class_obj_id=class_id, academic_year_id=academic_year_id,
        )
        serializer = StudentEnrollmentSerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['post'])
    def bulk_promote(self, request):
        """Promote students in bulk (background task)."""
        serializer = BulkPromoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        school_id = _resolve_school_id(request)
        source_year = serializer.validated_data['source_academic_year']
        target_year = serializer.validated_data['target_academic_year']
        promotions = serializer.validated_data['promotions']

        from core.models import BackgroundTask
        from .tasks import bulk_promote_task

        task_kwargs = {
            'school_id': school_id,
            'source_year_id': source_year.id,
            'target_year_id': target_year.id,
            'promotions': promotions,
        }
        title = f"Promoting {len(promotions)} students"

        if len(promotions) < 50:
            from core.task_utils import run_task_sync
            try:
                bg_task = run_task_sync(
                    bulk_promote_task, BackgroundTask.TaskType.BULK_PROMOTION,
                    title, school_id, request.user,
                    task_kwargs=task_kwargs, progress_total=len(promotions),
                )
            except Exception as e:
                return Response({'detail': str(e)}, status=500)
            return Response({
                'task_id': bg_task.celery_task_id,
                'message': bg_task.result_data.get('message', 'Promotion complete.') if bg_task.result_data else 'Promotion complete.',
                'result': bg_task.result_data,
            })
        else:
            from core.task_utils import dispatch_background_task
            bg_task = dispatch_background_task(
                celery_task_func=bulk_promote_task,
                task_type=BackgroundTask.TaskType.BULK_PROMOTION,
                title=title, school_id=school_id, user=request.user,
                task_kwargs=task_kwargs, progress_total=len(promotions),
            )
            return Response({
                'task_id': bg_task.celery_task_id,
                'message': 'Bulk promotion started.',
            }, status=202)


class PromotionAdvisorView(APIView):
    """AI Smart Promotion Advisor (background task)."""
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

    def post(self, request):
        academic_year = request.data.get('academic_year')
        class_id = request.data.get('class_id')

        if not academic_year or not class_id:
            return Response(
                {'detail': 'academic_year and class_id are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response(
                {'detail': 'No school context found.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from core.models import BackgroundTask
        from .tasks import promotion_advisor_task

        task_kwargs = {
            'school_id': school_id,
            'academic_year_id': int(academic_year),
            'class_id': int(class_id),
        }
        title = "Running promotion analysis"

        enrollment_count = StudentEnrollment.objects.filter(
            school_id=school_id,
            academic_year_id=int(academic_year),
            class_obj_id=int(class_id),
            is_active=True,
        ).count()

        if enrollment_count < 30:
            from core.task_utils import run_task_sync
            try:
                bg_task = run_task_sync(
                    promotion_advisor_task, BackgroundTask.TaskType.PROMOTION_ADVISOR,
                    title, school_id, request.user,
                    task_kwargs=task_kwargs, progress_total=100,
                )
            except Exception as e:
                return Response({'detail': str(e)}, status=500)
            return Response({
                'task_id': bg_task.celery_task_id,
                'message': bg_task.result_data.get('message', 'Analysis complete.') if bg_task.result_data else 'Analysis complete.',
                'result': bg_task.result_data,
            })
        else:
            from core.task_utils import dispatch_background_task
            bg_task = dispatch_background_task(
                celery_task_func=promotion_advisor_task,
                task_type=BackgroundTask.TaskType.PROMOTION_ADVISOR,
                title=title, school_id=school_id, user=request.user,
                task_kwargs=task_kwargs, progress_total=100,
            )
            return Response({
                'task_id': bg_task.celery_task_id,
                'message': 'Promotion analysis started.',
            }, status=202)


class SessionHealthView(APIView):
    """AI Session Health Dashboard endpoint."""
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get(self, request):
        from .session_health_service import SessionHealthService

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response(
                {'detail': 'No school context found.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        academic_year_id = request.query_params.get('academic_year')

        if not academic_year_id:
            # Default to the current academic year
            current = AcademicYear.objects.filter(
                school_id=school_id, is_current=True, is_active=True,
            ).first()
            if not current:
                return Response(
                    {'detail': 'No current academic year set for this school.'},
                    status=status.HTTP_404_NOT_FOUND,
                )
            academic_year_id = current.id

        service = SessionHealthService(school_id, int(academic_year_id))
        report = service.generate_health_report()

        if not report.get('success'):
            return Response(report, status=status.HTTP_404_NOT_FOUND)

        return Response(report)


class SessionSetupView(APIView):
    """AI Auto-Session Setup Wizard endpoints."""
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

    def post(self, request):
        """
        Generate setup preview or apply setup.

        POST with action='preview': Generate a preview of what will be created.
        POST with action='apply': Apply a reviewed preview to create everything.
        """
        from .session_setup_service import SessionSetupService

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response(
                {'detail': 'No school context found.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        action = request.data.get('action', 'preview')
        service = SessionSetupService(school_id)

        if action == 'preview':
            source_year_id = request.data.get('source_year_id')
            new_year_name = request.data.get('new_year_name')
            new_start_date = request.data.get('new_start_date')
            new_end_date = request.data.get('new_end_date')

            if not all([source_year_id, new_year_name, new_start_date, new_end_date]):
                return Response(
                    {'detail': 'source_year_id, new_year_name, new_start_date, new_end_date are required.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            from datetime import date as parse_date

            preview = service.generate_setup_preview(
                source_year_id=int(source_year_id),
                new_year_name=new_year_name,
                new_start_date=parse_date.fromisoformat(new_start_date),
                new_end_date=parse_date.fromisoformat(new_end_date),
            )
            return Response(preview)

        elif action == 'apply':
            preview_data = request.data.get('preview_data')
            if not preview_data:
                return Response(
                    {'detail': 'preview_data is required for apply action.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            result = service.apply_setup(preview_data, created_by=request.user)
            if not result['success']:
                http_status = status.HTTP_400_BAD_REQUEST
            elif result.get('sync_mode'):
                http_status = status.HTTP_200_OK
            else:
                http_status = status.HTTP_201_CREATED
            return Response(result, status=http_status)

        return Response(
            {'detail': f'Unknown action: {action}. Use "preview" or "apply".'},
            status=status.HTTP_400_BAD_REQUEST,
        )


class SectionAllocatorView(APIView):
    """AI Smart Section Allocator - distributes students across sections with balanced performance."""
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

    def post(self, request):
        """
        POST with action='preview' (default): Returns allocation preview without making changes.
        POST with action='apply': Creates/updates Class records and moves students.
        """
        from .section_allocator_service import SectionAllocatorService

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response(
                {'detail': 'No school context found.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        grade_id = request.data.get('grade_id')
        class_id = request.data.get('class_id')
        academic_year_id = request.data.get('academic_year_id')
        num_sections = request.data.get('num_sections')

        if not num_sections or not (grade_id or class_id):
            return Response(
                {'detail': 'num_sections and either class_id or grade_id are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            grade_id = int(grade_id) if grade_id else None
            class_id = int(class_id) if class_id else None
            academic_year_id = int(academic_year_id) if academic_year_id else None
            num_sections = int(num_sections)
        except (ValueError, TypeError):
            return Response(
                {'detail': 'IDs and num_sections must be integers.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        action = request.data.get('action', 'preview')
        service = SectionAllocatorService(school_id)

        if action == 'preview':
            result = service.allocate_students(
                grade_id=grade_id, academic_year_id=academic_year_id,
                num_sections=num_sections, class_id=class_id,
            )
            if not result.get('success'):
                return Response(result, status=status.HTTP_400_BAD_REQUEST)
            return Response(result)

        elif action == 'apply':
            allocation = service.allocate_students(
                grade_id=grade_id, academic_year_id=academic_year_id,
                num_sections=num_sections, class_id=class_id,
            )
            if not allocation.get('success'):
                return Response(allocation, status=status.HTTP_400_BAD_REQUEST)

            result = service.apply_allocation(
                grade_id=grade_id, academic_year_id=academic_year_id,
                allocation_data=allocation, class_id=class_id,
            )
            if not result.get('success'):
                return Response(result, status=status.HTTP_400_BAD_REQUEST)
            return Response(result, status=status.HTTP_200_OK)

        return Response(
            {'detail': f'Unknown action: {action}. Use "preview" or "apply".'},
            status=status.HTTP_400_BAD_REQUEST,
        )


class AttendanceRiskView(APIView):
    """AI Attendance Risk Predictor - identifies students at risk of poor attendance."""
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get(self, request):
        from .attendance_risk_service import AttendanceRiskService

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response(
                {'detail': 'No school context found.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        academic_year_id = request.query_params.get('academic_year')

        if not academic_year_id:
            # Default to the current academic year
            current = AcademicYear.objects.filter(
                school_id=school_id, is_current=True, is_active=True,
            ).first()
            if not current:
                return Response(
                    {'detail': 'No current academic year set for this school.'},
                    status=status.HTTP_404_NOT_FOUND,
                )
            academic_year_id = current.id

        threshold = float(request.query_params.get('threshold', 75))

        service = AttendanceRiskService(school_id, int(academic_year_id))
        result = service.get_at_risk_students(threshold=threshold)

        return Response(result)
