"""
Transport views for routes, stops, vehicles, assignments, and attendance.
"""

import logging

from django.db import transaction
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from core.permissions import (
    IsSchoolAdmin, IsSchoolAdminOrReadOnly, HasSchoolAccess, ModuleAccessMixin,
)
from core.mixins import TenantQuerySetMixin, ensure_tenant_school_id

from .models import (
    TransportRoute, TransportStop, TransportVehicle,
    TransportAssignment, TransportAttendance,
)
from .serializers import (
    TransportRouteReadSerializer, TransportRouteCreateSerializer,
    TransportStopSerializer,
    TransportVehicleReadSerializer, TransportVehicleCreateSerializer,
    TransportAssignmentReadSerializer, TransportAssignmentCreateSerializer,
    TransportAttendanceReadSerializer, TransportAttendanceCreateSerializer,
    BulkTransportAttendanceSerializer,
)

logger = logging.getLogger(__name__)


def _resolve_school_id(request):
    """
    Resolve school_id from: X-School-ID header -> params -> user.school_id -> fallback.
    """
    tenant_sid = ensure_tenant_school_id(request)
    if tenant_sid:
        return tenant_sid

    # If X-School-ID header was sent but rejected, don't fall back
    if request.headers.get('X-School-ID'):
        return None

    school_id = (
        request.query_params.get('school_id')
        or request.data.get('school_id')
        or request.data.get('school')
    )
    if school_id:
        return int(school_id)

    if request.user.school_id:
        return request.user.school_id

    if request.user.is_super_admin:
        from schools.models import School
        schools = list(School.objects.filter(is_active=True).values_list('id', flat=True)[:2])
        if len(schools) == 1:
            return schools[0]

    return None


# =============================================================================
# TransportRoute ViewSet
# =============================================================================

class TransportRouteViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    CRUD for transport routes.
    Admins get full access; other authenticated users get read-only access.
    """
    required_module = 'transport'
    queryset = TransportRoute.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return TransportRouteCreateSerializer
        return TransportRouteReadSerializer

    def get_queryset(self):
        queryset = TransportRoute.objects.select_related('school').prefetch_related(
            'stops', 'vehicles', 'transport_assignments',
        )

        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            from core.mixins import ensure_tenant_schools
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})
        serializer.save(school_id=school_id)

    @action(detail=True, methods=['get'], url_path='students')
    def students(self, request, pk=None):
        """List all students assigned to this route."""
        route = self.get_object()
        assignments = TransportAssignment.objects.filter(
            route=route, is_active=True,
        ).select_related(
            'student', 'student__class_obj', 'stop', 'vehicle', 'academic_year',
        )

        # Optional filter by academic year
        academic_year_id = request.query_params.get('academic_year')
        if academic_year_id:
            assignments = assignments.filter(academic_year_id=academic_year_id)

        serializer = TransportAssignmentReadSerializer(assignments, many=True)
        return Response(serializer.data)


# =============================================================================
# TransportStop ViewSet
# =============================================================================

class TransportStopViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    CRUD for transport stops.
    Filterable by route_id query parameter.
    Only admins can create/update/delete; others get read-only.
    """
    required_module = 'transport'
    queryset = TransportStop.objects.all()
    serializer_class = TransportStopSerializer
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None
    tenant_field = 'route__school_id'

    def get_queryset(self):
        queryset = TransportStop.objects.select_related('route', 'route__school')

        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(route__school_id=school_id)
        elif not self.request.user.is_super_admin:
            from core.mixins import ensure_tenant_schools
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(route__school_id__in=tenant_schools)
            else:
                return queryset.none()

        route_id = self.request.query_params.get('route_id')
        if route_id:
            queryset = queryset.filter(route_id=route_id)

        return queryset

    def perform_create(self, serializer):
        """Stops don't have a direct school FK; the school is on the route."""
        serializer.save()

    def perform_update(self, serializer):
        serializer.save()


# =============================================================================
# TransportVehicle ViewSet
# =============================================================================

class TransportVehicleViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    CRUD for transport vehicles.
    Admins get full access; other authenticated users get read-only access.
    """
    required_module = 'transport'
    queryset = TransportVehicle.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return TransportVehicleCreateSerializer
        return TransportVehicleReadSerializer

    def get_queryset(self):
        queryset = TransportVehicle.objects.select_related('school', 'assigned_route')

        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            from core.mixins import ensure_tenant_schools
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        route_id = self.request.query_params.get('route_id')
        if route_id:
            queryset = queryset.filter(assigned_route_id=route_id)

        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})
        serializer.save(school_id=school_id)


# =============================================================================
# TransportAssignment ViewSet
# =============================================================================

class TransportAssignmentViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    CRUD for student transport assignments.
    Filterable by route_id and student_id query parameters.
    Includes a bulk_assign action.
    """
    required_module = 'transport'
    queryset = TransportAssignment.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return TransportAssignmentCreateSerializer
        return TransportAssignmentReadSerializer

    def get_queryset(self):
        queryset = TransportAssignment.objects.select_related(
            'school', 'academic_year', 'student', 'student__class_obj',
            'route', 'stop', 'vehicle',
        )

        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            from core.mixins import ensure_tenant_schools
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        # Filters
        route_id = self.request.query_params.get('route_id')
        if route_id:
            queryset = queryset.filter(route_id=route_id)

        student_id = self.request.query_params.get('student_id')
        if student_id:
            queryset = queryset.filter(student_id=student_id)

        academic_year_id = self.request.query_params.get('academic_year')
        if academic_year_id:
            queryset = queryset.filter(academic_year_id=academic_year_id)

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})
        serializer.save(school_id=school_id)

    @action(detail=False, methods=['post'], permission_classes=[IsAuthenticated, IsSchoolAdmin, HasSchoolAccess])
    def bulk_assign(self, request):
        """
        Bulk assign multiple students to a route/stop.
        Expects:
        {
            "academic_year_id": 1,
            "route_id": 1,
            "stop_id": 1,
            "vehicle_id": null,  (optional)
            "transport_type": "BOTH",
            "student_ids": [1, 2, 3, ...]
        }
        """
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response(
                {'detail': 'No school associated with your account.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        academic_year_id = request.data.get('academic_year_id')
        route_id = request.data.get('route_id')
        stop_id = request.data.get('stop_id')
        vehicle_id = request.data.get('vehicle_id')
        transport_type = request.data.get('transport_type', 'BOTH')
        student_ids = request.data.get('student_ids', [])

        if not academic_year_id:
            return Response(
                {'detail': 'academic_year_id is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not route_id:
            return Response(
                {'detail': 'route_id is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not stop_id:
            return Response(
                {'detail': 'stop_id is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not student_ids:
            return Response(
                {'detail': 'student_ids is required and cannot be empty.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Validate that route and stop belong to this school
        try:
            route = TransportRoute.objects.get(id=route_id, school_id=school_id)
        except TransportRoute.DoesNotExist:
            return Response(
                {'detail': 'Route not found for this school.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            stop = TransportStop.objects.get(id=stop_id, route=route)
        except TransportStop.DoesNotExist:
            return Response(
                {'detail': 'Stop not found for this route.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        created_count = 0
        skipped_count = 0

        with transaction.atomic():
            for student_id in student_ids:
                # Check if assignment already exists
                existing = TransportAssignment.objects.filter(
                    school_id=school_id,
                    student_id=student_id,
                    academic_year_id=academic_year_id,
                ).exists()

                if existing:
                    skipped_count += 1
                    continue

                TransportAssignment.objects.create(
                    school_id=school_id,
                    academic_year_id=academic_year_id,
                    student_id=student_id,
                    route=route,
                    stop=stop,
                    vehicle_id=vehicle_id,
                    transport_type=transport_type,
                    is_active=True,
                )
                created_count += 1

        return Response({
            'created': created_count,
            'skipped': skipped_count,
            'total_requested': len(student_ids),
        }, status=status.HTTP_201_CREATED)


# =============================================================================
# TransportAttendance ViewSet
# =============================================================================

class TransportAttendanceViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    CRUD for transport attendance records.
    Filterable by route_id and date query parameters.
    Includes a bulk_mark action for marking attendance for an entire route.
    """
    required_module = 'transport'
    queryset = TransportAttendance.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return TransportAttendanceCreateSerializer
        return TransportAttendanceReadSerializer

    def get_queryset(self):
        queryset = TransportAttendance.objects.select_related(
            'school', 'student', 'student__class_obj', 'route', 'recorded_by',
        )

        school_id = _resolve_school_id(self.request)
        if school_id:
            queryset = queryset.filter(school_id=school_id)
        elif not self.request.user.is_super_admin:
            from core.mixins import ensure_tenant_schools
            tenant_schools = ensure_tenant_schools(self.request)
            if tenant_schools:
                queryset = queryset.filter(school_id__in=tenant_schools)
            else:
                return queryset.none()

        # Filters
        route_id = self.request.query_params.get('route_id')
        if route_id:
            queryset = queryset.filter(route_id=route_id)

        date_filter = self.request.query_params.get('date')
        if date_filter:
            queryset = queryset.filter(date=date_filter)

        student_id = self.request.query_params.get('student_id')
        if student_id:
            queryset = queryset.filter(student_id=student_id)

        boarding_status = self.request.query_params.get('boarding_status')
        if boarding_status:
            queryset = queryset.filter(boarding_status=boarding_status.upper())

        return queryset

    def perform_create(self, serializer):
        school_id = _resolve_school_id(self.request)
        if not school_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'detail': 'No school associated with your account.'})
        serializer.save(school_id=school_id, recorded_by=self.request.user)

    @action(detail=False, methods=['post'], permission_classes=[IsAuthenticated, IsSchoolAdmin, HasSchoolAccess])
    def bulk_mark(self, request):
        """
        Bulk mark transport attendance for a given route and date.
        Expects:
        {
            "route_id": 1,
            "date": "2026-02-13",
            "records": [
                {"student_id": 1, "boarding_status": "BOARDED"},
                {"student_id": 2, "boarding_status": "ABSENT"},
                ...
            ]
        }
        Creates or updates attendance records for each student.
        """
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response(
                {'detail': 'No school associated with your account.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = BulkTransportAttendanceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        route_id = serializer.validated_data['route_id']
        attendance_date = serializer.validated_data['date']
        records = serializer.validated_data['records']

        # Validate route belongs to this school
        try:
            route = TransportRoute.objects.get(id=route_id, school_id=school_id)
        except TransportRoute.DoesNotExist:
            return Response(
                {'detail': 'Route not found for this school.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        created_count = 0
        updated_count = 0
        errors = []

        with transaction.atomic():
            for record in records:
                student_id = record['student_id']
                boarding_status_val = record['boarding_status']

                try:
                    attendance, created = TransportAttendance.objects.update_or_create(
                        school_id=school_id,
                        student_id=student_id,
                        route=route,
                        date=attendance_date,
                        defaults={
                            'boarding_status': boarding_status_val,
                            'recorded_by': request.user,
                        },
                    )
                    if created:
                        created_count += 1
                    else:
                        updated_count += 1
                except Exception as e:
                    errors.append({
                        'student_id': student_id,
                        'error': str(e),
                    })

        return Response({
            'route_id': route_id,
            'date': str(attendance_date),
            'created': created_count,
            'updated': updated_count,
            'errors': errors,
            'total_processed': created_count + updated_count,
        }, status=status.HTTP_200_OK)
