from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

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
