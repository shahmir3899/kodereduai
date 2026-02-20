"""
Transport views for routes, stops, vehicles, assignments, and attendance.
"""

import logging

from django.db import transaction
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from core.permissions import (
    IsSchoolAdmin, IsSchoolAdminOrReadOnly, HasSchoolAccess, ModuleAccessMixin,
    IsDriverOrAdmin, ADMIN_ROLES, get_effective_role,
)
from core.mixins import TenantQuerySetMixin, ensure_tenant_school_id

from .models import (
    TransportRoute, TransportStop, TransportVehicle,
    TransportAssignment, TransportAttendance,
    RouteJourney, RouteLocationUpdate,
)
from .serializers import (
    TransportRouteReadSerializer, TransportRouteCreateSerializer,
    TransportStopSerializer,
    TransportVehicleReadSerializer, TransportVehicleCreateSerializer,
    TransportAssignmentReadSerializer, TransportAssignmentCreateSerializer,
    TransportAttendanceReadSerializer, TransportAttendanceCreateSerializer,
    BulkTransportAttendanceSerializer,
    RouteJourneyReadSerializer, RouteJourneyCreateSerializer,
    RouteJourneyUpdateSerializer, RouteLocationUpdateSerializer,
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
# Transport Dashboard
# =============================================================================

class TransportDashboardView(ModuleAccessMixin, APIView):
    """GET /api/transport/dashboard/ — Transport overview stats."""
    required_module = 'transport'
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get(self, request):
        from datetime import date as date_cls
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school selected.'}, status=status.HTTP_400_BAD_REQUEST)

        total_routes = TransportRoute.objects.filter(school_id=school_id, is_active=True).count()
        total_vehicles = TransportVehicle.objects.filter(school_id=school_id, is_active=True).count()
        students_assigned = TransportAssignment.objects.filter(school_id=school_id, is_active=True).count()
        today_attendance = TransportAttendance.objects.filter(
            school_id=school_id, date=date_cls.today(),
        ).count()

        return Response({
            'total_routes': total_routes,
            'total_vehicles': total_vehicles,
            'students_assigned': students_assigned,
            'today_attendance': today_attendance,
        })


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


    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return TransportRouteCreateSerializer
        return TransportRouteReadSerializer

    def get_queryset(self):
        from django.db.models import Count, Q, Sum
        queryset = TransportRoute.objects.select_related('school').annotate(
            stops_count=Count('stops'),
            vehicles_count=Count('vehicles', filter=Q(vehicles__is_active=True)),
            students_count=Count('transport_assignments', filter=Q(transport_assignments__is_active=True)),
            total_capacity=Sum('vehicles__capacity', filter=Q(vehicles__is_active=True), default=0),
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
        instance = serializer.save(school_id=school_id)
        self._auto_distance(instance)

    def perform_update(self, serializer):
        instance = serializer.save()
        self._auto_distance(instance)

    def _auto_distance(self, route):
        """Auto-calculate distance_km if not explicitly set and coords exist."""
        if not route.distance_km and route.start_latitude and route.end_latitude:
            from .utils import auto_calculate_route_distance
            dist = auto_calculate_route_distance(route)
            if dist:
                route.distance_km = dist
                route.save(update_fields=['distance_km'])

    @action(detail=True, methods=['post'], url_path='duplicate',
            permission_classes=[IsAuthenticated, IsSchoolAdmin, HasSchoolAccess])
    def duplicate(self, request, pk=None):
        """Clone a route and all its stops."""
        original = self.get_object()
        stops = TransportStop.objects.filter(route=original)

        # Find a unique name
        base_name = f"{original.name} (Copy)"
        name = base_name
        counter = 2
        while TransportRoute.objects.filter(school=original.school, name=name).exists():
            name = f"{base_name} {counter}"
            counter += 1

        new_route = TransportRoute.objects.create(
            school=original.school,
            name=name,
            description=original.description,
            start_location=original.start_location,
            end_location=original.end_location,
            start_latitude=original.start_latitude,
            start_longitude=original.start_longitude,
            end_latitude=original.end_latitude,
            end_longitude=original.end_longitude,
            distance_km=original.distance_km,
            estimated_duration_minutes=original.estimated_duration_minutes,
            is_active=original.is_active,
        )

        for stop in stops:
            TransportStop.objects.create(
                route=new_route,
                name=stop.name,
                address=stop.address,
                latitude=stop.latitude,
                longitude=stop.longitude,
                stop_order=stop.stop_order,
                pickup_time=stop.pickup_time,
                drop_time=stop.drop_time,
            )

        # Re-fetch with annotations
        from django.db.models import Count, Q, Sum
        annotated = TransportRoute.objects.filter(id=new_route.id).annotate(
            stops_count=Count('stops'),
            vehicles_count=Count('vehicles', filter=Q(vehicles__is_active=True)),
            students_count=Count('transport_assignments', filter=Q(transport_assignments__is_active=True)),
            total_capacity=Sum('vehicles__capacity', filter=Q(vehicles__is_active=True), default=0),
        ).first()

        return Response(
            TransportRouteReadSerializer(annotated).data,
            status=status.HTTP_201_CREATED,
        )

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

        route_id = self.request.query_params.get('route_id') or self.request.query_params.get('route')
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
    Includes a 'my' action for drivers to fetch their assigned vehicle.
    """
    required_module = 'transport'
    queryset = TransportVehicle.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]

    @action(detail=False, methods=['get'], url_path='my',
            permission_classes=[IsAuthenticated])
    def my_vehicle(self, request):
        """GET /api/transport/vehicles/my/ — Driver fetches their assigned vehicle."""
        vehicle = TransportVehicle.objects.filter(
            driver_user=request.user, is_active=True,
        ).select_related('school', 'assigned_route').first()

        if not vehicle:
            return Response(
                {'detail': 'No vehicle assigned to your account.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(TransportVehicleReadSerializer(vehicle).data)

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

        transport_type = self.request.query_params.get('transport_type')
        if transport_type:
            queryset = queryset.filter(transport_type=transport_type.upper())

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


# =============================================================================
# GPS Journey Views
# =============================================================================

class JourneyStartView(APIView):
    """POST /api/transport/journey/start/ — Student starts a journey."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from .serializers import JourneyStartSerializer, StudentJourneyReadSerializer
        from .models import StudentJourney
        from students.models import Student

        serializer = JourneyStartSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Find the student linked to this user
        try:
            student = Student.objects.get(user=request.user)
        except Student.DoesNotExist:
            return Response({'error': 'No student profile found.'}, status=status.HTTP_404_NOT_FOUND)

        # Check for existing active journey
        active = StudentJourney.objects.filter(student=student, status='ACTIVE').first()
        if active:
            return Response({'error': 'You already have an active journey.', 'journey_id': active.id},
                            status=status.HTTP_400_BAD_REQUEST)

        # Find transport assignment
        assignment = student.transport_assignments.filter(is_active=True).first()

        journey = StudentJourney.objects.create(
            school=student.school,
            student=student,
            transport_assignment=assignment,
            journey_type=serializer.validated_data['journey_type'],
            start_latitude=serializer.validated_data['latitude'],
            start_longitude=serializer.validated_data['longitude'],
        )
        return Response(StudentJourneyReadSerializer(journey).data, status=status.HTTP_201_CREATED)


class JourneyEndView(APIView):
    """POST /api/transport/journey/end/ — Student ends a journey."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from .serializers import StudentJourneyReadSerializer
        from .models import StudentJourney
        from students.models import Student
        from django.utils import timezone

        journey_id = request.data.get('journey_id')
        if not journey_id:
            return Response({'error': 'journey_id is required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            student = Student.objects.get(user=request.user)
        except Student.DoesNotExist:
            return Response({'error': 'No student profile found.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            journey = StudentJourney.objects.get(id=journey_id, student=student, status='ACTIVE')
        except StudentJourney.DoesNotExist:
            return Response({'error': 'Active journey not found.'}, status=status.HTTP_404_NOT_FOUND)

        latitude = request.data.get('latitude')
        longitude = request.data.get('longitude')

        journey.status = 'COMPLETED'
        journey.ended_at = timezone.now()
        if latitude and longitude:
            journey.end_latitude = latitude
            journey.end_longitude = longitude
        journey.save()

        return Response(StudentJourneyReadSerializer(journey).data)


class JourneyUpdateView(APIView):
    """POST /api/transport/journey/update/ — GPS ping every 30s."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from .serializers import JourneyUpdateSerializer
        from .models import StudentJourney, LocationUpdate

        serializer = JourneyUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data

        try:
            journey = StudentJourney.objects.get(id=d['journey_id'], status='ACTIVE')
        except StudentJourney.DoesNotExist:
            return Response({'error': 'Active journey not found.'}, status=status.HTTP_404_NOT_FOUND)

        LocationUpdate.objects.create(
            journey=journey,
            latitude=d['latitude'],
            longitude=d['longitude'],
            accuracy=d['accuracy'],
            speed=d.get('speed'),
            battery_level=d.get('battery_level'),
        )
        return Response({'status': 'ok'})


class JourneyTrackView(APIView):
    """GET /api/transport/journey/track/<student_id>/ — Parent tracks child."""
    permission_classes = [IsAuthenticated]

    def get(self, request, student_id):
        from .serializers import StudentJourneyReadSerializer, LocationUpdateSerializer
        from .models import StudentJourney

        journey = StudentJourney.objects.filter(
            student_id=student_id, status='ACTIVE',
        ).first()

        if not journey:
            return Response({'active': False, 'message': 'No active journey.'})

        locations = journey.locations.all()[:50]
        return Response({
            'active': True,
            'journey': StudentJourneyReadSerializer(journey).data,
            'locations': LocationUpdateSerializer(locations, many=True).data,
        })


class JourneyHistoryView(APIView):
    """GET /api/transport/journey/history/<student_id>/ — Past journeys."""
    permission_classes = [IsAuthenticated]

    def get(self, request, student_id):
        from .serializers import StudentJourneyReadSerializer
        from .models import StudentJourney

        journeys = StudentJourney.objects.filter(
            student_id=student_id,
        ).order_by('-started_at')[:20]
        return Response(StudentJourneyReadSerializer(journeys, many=True).data)


class ActiveJourneysView(APIView):
    """GET /api/transport/journey/active/ — Admin: all active journeys."""
    permission_classes = [IsAuthenticated, IsSchoolAdmin]

    def get(self, request):
        from .serializers import StudentJourneyReadSerializer
        from .models import StudentJourney

        school_id = ensure_tenant_school_id(request)
        journeys = StudentJourney.objects.filter(
            school_id=school_id, status='ACTIVE',
        )
        return Response(StudentJourneyReadSerializer(journeys, many=True).data)


# =============================================================================
# Route Journey Views (driver/vehicle-centric tracking)
# =============================================================================

class RouteJourneyStartView(APIView):
    """
    POST /api/transport/route-journey/start/
    Driver starts a journey (auto-detects vehicle/route from driver_user),
    or admin starts a manual journey by providing route_id.
    """
    permission_classes = [IsAuthenticated, IsDriverOrAdmin]

    def post(self, request):
        serializer = RouteJourneyCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data

        role = get_effective_role(request)

        if role == 'DRIVER':
            # Driver mode: find vehicle assigned to this user
            vehicle = TransportVehicle.objects.filter(
                driver_user=request.user, is_active=True,
            ).select_related('assigned_route', 'school').first()

            if not vehicle:
                return Response(
                    {'error': 'No active vehicle assigned to your account.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not vehicle.assigned_route:
                return Response(
                    {'error': 'Your vehicle is not assigned to any route.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            route = vehicle.assigned_route
            school = vehicle.school
            tracking_mode = 'DRIVER_APP'
        elif role in ADMIN_ROLES:
            # Admin manual mode: route_id required
            route_id = d.get('route_id')
            if not route_id:
                return Response(
                    {'error': 'route_id is required for admin-initiated journeys.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            school_id = _resolve_school_id(request)
            try:
                route = TransportRoute.objects.get(id=route_id, school_id=school_id)
            except TransportRoute.DoesNotExist:
                return Response({'error': 'Route not found.'}, status=status.HTTP_404_NOT_FOUND)

            vehicle = route.vehicles.filter(is_active=True).first()
            school = route.school
            tracking_mode = 'MANUAL'
        else:
            return Response({'error': 'Unauthorized role.'}, status=status.HTTP_403_FORBIDDEN)

        # Check for existing active journey on this route
        active = RouteJourney.objects.filter(route=route, status='ACTIVE').first()
        if active:
            return Response(
                {'error': 'An active journey already exists for this route.', 'journey_id': active.id},
                status=status.HTTP_400_BAD_REQUEST,
            )

        journey = RouteJourney.objects.create(
            school=school,
            route=route,
            vehicle=vehicle,
            driver=request.user,
            journey_type=d['journey_type'],
            tracking_mode=tracking_mode,
            start_latitude=d.get('latitude'),
            start_longitude=d.get('longitude'),
        )

        # Trigger departure notification
        try:
            from .triggers import trigger_bus_departed
            trigger_bus_departed(journey)
        except Exception:
            logger.exception("Failed to send bus departed notification")

        return Response(RouteJourneyReadSerializer(journey).data, status=status.HTTP_201_CREATED)


class RouteJourneyEndView(APIView):
    """POST /api/transport/route-journey/end/ — Driver or admin ends a journey."""
    permission_classes = [IsAuthenticated, IsDriverOrAdmin]

    def post(self, request):
        from django.utils import timezone

        journey_id = request.data.get('journey_id')
        if not journey_id:
            return Response({'error': 'journey_id is required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            journey = RouteJourney.objects.get(id=journey_id, status='ACTIVE')
        except RouteJourney.DoesNotExist:
            return Response({'error': 'Active journey not found.'}, status=status.HTTP_404_NOT_FOUND)

        # Verify user is the driver or an admin
        role = get_effective_role(request)
        if role not in ADMIN_ROLES and journey.driver_id != request.user.id:
            return Response({'error': 'Not authorized to end this journey.'}, status=status.HTTP_403_FORBIDDEN)

        latitude = request.data.get('latitude')
        longitude = request.data.get('longitude')

        journey.status = 'COMPLETED'
        journey.ended_at = timezone.now()
        if latitude and longitude:
            journey.end_latitude = latitude
            journey.end_longitude = longitude
        journey.save()

        # Trigger completion notification
        try:
            from .triggers import trigger_journey_completed
            trigger_journey_completed(journey)
        except Exception:
            logger.exception("Failed to send journey completed notification")

        return Response(RouteJourneyReadSerializer(journey).data)


class RouteJourneyUpdateView(APIView):
    """POST /api/transport/route-journey/update/ — GPS ping every 30s from driver app."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = RouteJourneyUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data

        try:
            journey = RouteJourney.objects.get(id=d['journey_id'], status='ACTIVE')
        except RouteJourney.DoesNotExist:
            return Response({'error': 'Active journey not found.'}, status=status.HTTP_404_NOT_FOUND)

        RouteLocationUpdate.objects.create(
            journey=journey,
            latitude=d['latitude'],
            longitude=d['longitude'],
            accuracy=d.get('accuracy', 0),
            speed=d.get('speed'),
            battery_level=d.get('battery_level'),
            source='APP',
        )

        # Geofence check (runs async-safe, catches its own exceptions)
        from .utils import check_geofence
        check_geofence(journey, d['latitude'], d['longitude'])

        return Response({'status': 'ok'})


class RouteJourneyTrackView(APIView):
    """
    GET /api/transport/route-journey/track/<student_id>/
    Parent tracks their child's bus by looking up the student's route assignment
    and finding the active RouteJourney for that route.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, student_id):
        # Find student's active transport assignment -> route
        assignment = TransportAssignment.objects.filter(
            student_id=student_id, is_active=True,
        ).select_related('route').first()

        if not assignment:
            return Response({'active': False, 'message': 'No transport assignment found for this student.'})

        # Find active RouteJourney for this route
        journey = RouteJourney.objects.filter(
            route=assignment.route, status='ACTIVE',
        ).first()

        if not journey:
            return Response({'active': False, 'message': 'No active journey on this route.'})

        locations = journey.locations.all()[:50]
        return Response({
            'active': True,
            'journey': RouteJourneyReadSerializer(journey).data,
            'locations': RouteLocationUpdateSerializer(locations, many=True).data,
            'student_stop': {
                'id': assignment.stop_id,
                'name': assignment.stop.name if assignment.stop else None,
            },
        })


class ActiveRouteJourneysView(APIView):
    """GET /api/transport/route-journey/active/ — Admin: all active route journeys."""
    permission_classes = [IsAuthenticated, IsSchoolAdmin]

    def get(self, request):
        school_id = _resolve_school_id(request)
        if not school_id:
            return Response({'detail': 'No school selected.'}, status=status.HTTP_400_BAD_REQUEST)

        journeys = RouteJourney.objects.filter(
            school_id=school_id, status='ACTIVE',
        ).select_related('route', 'vehicle', 'driver')
        return Response(RouteJourneyReadSerializer(journeys, many=True).data)


class RouteJourneyHistoryView(APIView):
    """GET /api/transport/route-journey/history/ — Past route journeys, filterable by route_id."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        school_id = _resolve_school_id(request)
        queryset = RouteJourney.objects.filter(school_id=school_id).order_by('-started_at')

        route_id = request.query_params.get('route_id')
        if route_id:
            queryset = queryset.filter(route_id=route_id)

        return Response(RouteJourneyReadSerializer(queryset[:20], many=True).data)
