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
    pagination_class = None

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return AcademicYearCreateSerializer
        return AcademicYearSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['school_id'] = _resolve_school_id(self.request)
        return ctx

    def get_queryset(self):
        qs = super().get_queryset().select_related('school')
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() == 'true')
        else:
            qs = qs.filter(is_active=True)
        return qs

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save()

    @action(detail=True, methods=['post'])
    def set_current(self, request, pk=None):
        year = self.get_object()
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
            school_id=school_id, is_current=True, is_active=True,
        ).select_related('school').first()
        if not year:
            return Response(
                {'detail': 'No current academic year set for this school.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        data = AcademicYearSerializer(year).data
        # Include terms for the current year
        terms = Term.objects.filter(
            academic_year=year, is_active=True,
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
            'terms_count': year.terms.filter(is_active=True).count(),
            'enrollment_count': year.enrollments.filter(is_active=True).count(),
            'classes_count': year.enrollments.filter(
                is_active=True,
            ).values('class_obj').distinct().count(),
        })


class TermViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    queryset = Term.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

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
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() == 'true')
        else:
            qs = qs.filter(is_active=True)
        return qs

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save()


class StudentEnrollmentViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    queryset = StudentEnrollment.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

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
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() == 'true')
        else:
            qs = qs.filter(is_active=True)
        return qs

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
        serializer = BulkPromoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        school_id = _resolve_school_id(request)
        source_year = serializer.validated_data['source_academic_year']
        target_year = serializer.validated_data['target_academic_year']
        promotions = serializer.validated_data['promotions']

        created = 0
        errors = []

        for promo in promotions:
            student_id = promo.get('student_id')
            target_class_id = promo.get('target_class_id')
            new_roll_number = promo.get('new_roll_number', '')

            # Mark old enrollment as promoted
            old_enrollment = StudentEnrollment.objects.filter(
                school_id=school_id,
                student_id=student_id,
                academic_year=source_year,
                is_active=True,
            ).first()

            if old_enrollment:
                old_enrollment.status = StudentEnrollment.Status.PROMOTED
                old_enrollment.save(update_fields=['status'])
                if not new_roll_number:
                    new_roll_number = old_enrollment.roll_number

            # Create new enrollment
            try:
                StudentEnrollment.objects.create(
                    school_id=school_id,
                    student_id=student_id,
                    academic_year=target_year,
                    class_obj_id=target_class_id,
                    roll_number=new_roll_number,
                    status=StudentEnrollment.Status.ACTIVE,
                )
                # Update student's current class
                from students.models import Student
                Student.objects.filter(pk=student_id).update(
                    class_obj_id=target_class_id,
                    roll_number=new_roll_number,
                )
                created += 1
            except Exception as e:
                errors.append({'student_id': student_id, 'error': str(e)})

        return Response({
            'promoted': created,
            'errors': errors,
            'message': f'{created} students promoted successfully.',
        })


class PromotionAdvisorView(APIView):
    """AI Smart Promotion Advisor - analyzes student data and recommends promotion decisions."""
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

    def get(self, request):
        academic_year = request.query_params.get('academic_year')
        class_id = request.query_params.get('class_id')

        if not academic_year or not class_id:
            return Response(
                {'detail': 'academic_year and class_id query params are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        school_id = _resolve_school_id(request)
        if not school_id:
            return Response(
                {'detail': 'No school context found.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from .promotion_advisor_service import PromotionAdvisorService

        service = PromotionAdvisorService(school_id, int(academic_year))
        recommendations = service.get_recommendations(int(class_id))

        return Response({
            'recommendations': recommendations,
            'total': len(recommendations),
            'summary': {
                'promote': sum(1 for r in recommendations if r['recommendation'] == 'PROMOTE'),
                'needs_review': sum(1 for r in recommendations if r['recommendation'] == 'NEEDS_REVIEW'),
                'retain': sum(1 for r in recommendations if r['recommendation'] == 'RETAIN'),
            },
        })


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
            fee_increase_percent = request.data.get('fee_increase_percent', 0)

            if not all([source_year_id, new_year_name, new_start_date, new_end_date]):
                return Response(
                    {'detail': 'source_year_id, new_year_name, new_start_date, new_end_date are required.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            from decimal import Decimal
            from datetime import date as parse_date

            preview = service.generate_setup_preview(
                source_year_id=int(source_year_id),
                new_year_name=new_year_name,
                new_start_date=parse_date.fromisoformat(new_start_date),
                new_end_date=parse_date.fromisoformat(new_end_date),
                fee_increase_percent=Decimal(str(fee_increase_percent)),
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
            return Response(result, status=status.HTTP_201_CREATED if result['success'] else status.HTTP_400_BAD_REQUEST)

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
