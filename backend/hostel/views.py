"""
Hostel views for hostels, rooms, allocations, gate passes, and dashboard stats.
"""

from datetime import date

from django.db.models import Sum, Count, Q
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated

from core.permissions import (
    IsSchoolAdmin, IsSchoolAdminOrReadOnly, HasSchoolAccess, ModuleAccessMixin,
)
from core.mixins import TenantQuerySetMixin, ensure_tenant_school_id

from .models import Hostel, Room, HostelAllocation, GatePass
from .serializers import (
    HostelReadSerializer, HostelCreateSerializer,
    RoomReadSerializer, RoomCreateSerializer,
    HostelAllocationReadSerializer, HostelAllocationCreateSerializer,
    GatePassReadSerializer, GatePassCreateSerializer,
)


# =============================================================================
# Hostel ViewSet
# =============================================================================

class HostelViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    CRUD for hostel buildings.
    Admins get full access; other authenticated users get read-only access.
    """
    required_module = 'hostel'
    queryset = Hostel.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return HostelCreateSerializer
        return HostelReadSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related('school', 'warden')

        # Optional filters
        hostel_type = self.request.query_params.get('hostel_type')
        if hostel_type:
            queryset = queryset.filter(hostel_type=hostel_type.upper())

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        return queryset


# =============================================================================
# Room ViewSet
# =============================================================================

class RoomViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    CRUD for rooms within hostels.
    Filterable by hostel_id query parameter.
    Admins get full access; other authenticated users get read-only access.
    """
    required_module = 'hostel'
    queryset = Room.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None
    tenant_field = 'hostel__school_id'

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return RoomCreateSerializer
        return RoomReadSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related('hostel', 'hostel__school')

        # Filter by hostel
        hostel_id = self.request.query_params.get('hostel_id')
        if hostel_id:
            queryset = queryset.filter(hostel_id=hostel_id)

        # Filter by floor
        floor = self.request.query_params.get('floor')
        if floor is not None:
            queryset = queryset.filter(floor=floor)

        # Filter by room type
        room_type = self.request.query_params.get('room_type')
        if room_type:
            queryset = queryset.filter(room_type=room_type.upper())

        # Filter by availability
        is_available = self.request.query_params.get('is_available')
        if is_available is not None:
            queryset = queryset.filter(is_available=is_available.lower() == 'true')

        return queryset

    def perform_create(self, serializer):
        """Rooms don't have a direct school FK; the school is on the hostel."""
        serializer.save()

    def perform_update(self, serializer):
        serializer.save()


# =============================================================================
# HostelAllocation ViewSet
# =============================================================================

class HostelAllocationViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    CRUD for student hostel allocations.
    Includes a 'vacate' action to mark a student as vacated.
    Filterable by hostel_id, room_id, student_id, academic_year, and is_active.
    """
    required_module = 'hostel'
    queryset = HostelAllocation.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return HostelAllocationCreateSerializer
        return HostelAllocationReadSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            'school', 'student', 'student__class_obj',
            'room', 'room__hostel', 'academic_year',
        )

        # Filter by hostel
        hostel_id = self.request.query_params.get('hostel_id')
        if hostel_id:
            queryset = queryset.filter(room__hostel_id=hostel_id)

        # Filter by room
        room_id = self.request.query_params.get('room_id')
        if room_id:
            queryset = queryset.filter(room_id=room_id)

        # Filter by student
        student_id = self.request.query_params.get('student_id')
        if student_id:
            queryset = queryset.filter(student_id=student_id)

        # Filter by academic year
        academic_year_id = self.request.query_params.get('academic_year')
        if academic_year_id:
            queryset = queryset.filter(academic_year_id=academic_year_id)

        # Filter by active status
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')

        return queryset

    @action(
        detail=True, methods=['patch'],
        permission_classes=[IsAuthenticated, IsSchoolAdmin, HasSchoolAccess],
    )
    def vacate(self, request, pk=None):
        """
        Mark a student as vacated from their hostel room.
        Sets is_active=False and vacated_date=today.
        """
        allocation = self.get_object()

        if not allocation.is_active:
            return Response(
                {'detail': 'This allocation is already inactive.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        allocation.is_active = False
        allocation.vacated_date = date.today()
        allocation.save(update_fields=['is_active', 'vacated_date'])

        serializer = HostelAllocationReadSerializer(allocation)
        return Response(serializer.data)


# =============================================================================
# GatePass ViewSet
# =============================================================================

class GatePassViewSet(ModuleAccessMixin, TenantQuerySetMixin, viewsets.ModelViewSet):
    """
    CRUD for hostel gate passes.
    Includes actions: approve, reject, checkout, return_pass.
    Filterable by student_id, status, and pass_type.
    """
    required_module = 'hostel'
    queryset = GatePass.objects.all()
    permission_classes = [IsAuthenticated, IsSchoolAdminOrReadOnly, HasSchoolAccess]
    pagination_class = None

    def get_serializer_class(self):
        if self.action in ('create', 'update', 'partial_update'):
            return GatePassCreateSerializer
        return GatePassReadSerializer

    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            'school', 'student', 'allocation', 'allocation__room',
            'allocation__room__hostel', 'approved_by',
        )

        # Filter by student
        student_id = self.request.query_params.get('student_id')
        if student_id:
            queryset = queryset.filter(student_id=student_id)

        # Filter by status
        gate_pass_status = self.request.query_params.get('status')
        if gate_pass_status:
            queryset = queryset.filter(status=gate_pass_status.upper())

        # Filter by pass type
        pass_type = self.request.query_params.get('pass_type')
        if pass_type:
            queryset = queryset.filter(pass_type=pass_type.upper())

        # Filter by hostel
        hostel_id = self.request.query_params.get('hostel_id')
        if hostel_id:
            queryset = queryset.filter(allocation__room__hostel_id=hostel_id)

        return queryset

    @action(
        detail=True, methods=['patch'],
        permission_classes=[IsAuthenticated, IsSchoolAdmin, HasSchoolAccess],
    )
    def approve(self, request, pk=None):
        """Approve a pending gate pass."""
        gate_pass = self.get_object()

        if gate_pass.status != 'PENDING':
            return Response(
                {'detail': f'Cannot approve a gate pass with status "{gate_pass.get_status_display()}".'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        gate_pass.status = 'APPROVED'
        gate_pass.approved_by = request.user
        gate_pass.approved_at = timezone.now()
        gate_pass.remarks = request.data.get('remarks', gate_pass.remarks)
        gate_pass.save(update_fields=['status', 'approved_by', 'approved_at', 'remarks', 'updated_at'])

        serializer = GatePassReadSerializer(gate_pass)
        return Response(serializer.data)

    @action(
        detail=True, methods=['patch'],
        permission_classes=[IsAuthenticated, IsSchoolAdmin, HasSchoolAccess],
    )
    def reject(self, request, pk=None):
        """Reject a pending gate pass."""
        gate_pass = self.get_object()

        if gate_pass.status != 'PENDING':
            return Response(
                {'detail': f'Cannot reject a gate pass with status "{gate_pass.get_status_display()}".'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        gate_pass.status = 'REJECTED'
        gate_pass.approved_by = request.user
        gate_pass.approved_at = timezone.now()
        gate_pass.remarks = request.data.get('remarks', gate_pass.remarks)
        gate_pass.save(update_fields=['status', 'approved_by', 'approved_at', 'remarks', 'updated_at'])

        serializer = GatePassReadSerializer(gate_pass)
        return Response(serializer.data)

    @action(
        detail=True, methods=['patch'],
        permission_classes=[IsAuthenticated, IsSchoolAdmin, HasSchoolAccess],
    )
    def checkout(self, request, pk=None):
        """Mark an approved gate pass as checked out (student has left)."""
        gate_pass = self.get_object()

        if gate_pass.status != 'APPROVED':
            return Response(
                {'detail': 'Only approved gate passes can be checked out.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        gate_pass.status = 'USED'
        gate_pass.save(update_fields=['status', 'updated_at'])

        serializer = GatePassReadSerializer(gate_pass)
        return Response(serializer.data)

    @action(
        detail=True, methods=['patch'], url_path='return',
        permission_classes=[IsAuthenticated, IsSchoolAdmin, HasSchoolAccess],
    )
    def return_pass(self, request, pk=None):
        """Mark a checked-out gate pass as returned (student is back)."""
        gate_pass = self.get_object()

        if gate_pass.status != 'USED':
            return Response(
                {'detail': 'Only checked-out gate passes can be marked as returned.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        gate_pass.status = 'RETURNED'
        gate_pass.actual_return = timezone.now()
        gate_pass.save(update_fields=['status', 'actual_return', 'updated_at'])

        serializer = GatePassReadSerializer(gate_pass)
        return Response(serializer.data)


# =============================================================================
# Dashboard View
# =============================================================================

class HostelDashboardView(ModuleAccessMixin, APIView):
    """
    GET: Returns aggregate hostel statistics for the active school.
    {total_hostels, total_rooms, total_capacity, current_occupancy, pending_gate_passes}
    """
    required_module = 'hostel'
    permission_classes = [IsAuthenticated, HasSchoolAccess]

    def get(self, request):
        school_id = ensure_tenant_school_id(request)
        if not school_id:
            return Response(
                {'detail': 'No school associated with your account.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        total_hostels = Hostel.objects.filter(
            school_id=school_id, is_active=True,
        ).count()

        total_rooms = Room.objects.filter(
            hostel__school_id=school_id, hostel__is_active=True,
        ).count()

        total_capacity = Room.objects.filter(
            hostel__school_id=school_id, hostel__is_active=True, is_available=True,
        ).aggregate(total=Sum('capacity'))['total'] or 0

        current_occupancy = HostelAllocation.objects.filter(
            school_id=school_id, is_active=True,
        ).count()

        pending_gate_passes = GatePass.objects.filter(
            school_id=school_id, status='PENDING',
        ).count()

        available_beds = total_capacity - current_occupancy

        boys_hostels = Hostel.objects.filter(
            school_id=school_id, is_active=True, hostel_type='BOYS',
        ).count()

        girls_hostels = Hostel.objects.filter(
            school_id=school_id, is_active=True, hostel_type='GIRLS',
        ).count()

        students_on_leave = GatePass.objects.filter(
            school_id=school_id, status='USED',
        ).count()

        return Response({
            'total_hostels': total_hostels,
            'total_rooms': total_rooms,
            'total_capacity': total_capacity,
            'current_occupancy': current_occupancy,
            'available_beds': available_beds,
            'pending_gate_passes': pending_gate_passes,
            'boys_hostels': boys_hostels,
            'girls_hostels': girls_hostels,
            'students_on_leave': students_on_leave,
        })
