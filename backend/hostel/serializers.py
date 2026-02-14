"""
Hostel serializers with Read (nested details) and Create (flat IDs) pattern.
"""

from rest_framework import serializers
from .models import Hostel, Room, HostelAllocation, GatePass


# =============================================================================
# Hostel Serializers
# =============================================================================

class HostelReadSerializer(serializers.ModelSerializer):
    """Read serializer with computed fields for occupancy."""
    school_name = serializers.CharField(source='school.name', read_only=True)
    hostel_type_display = serializers.CharField(
        source='get_hostel_type_display', read_only=True,
    )
    warden_name = serializers.CharField(
        source='warden.full_name', read_only=True, default=None,
    )
    current_occupancy = serializers.IntegerField(read_only=True)
    rooms_count = serializers.IntegerField(source='rooms.count', read_only=True)

    class Meta:
        model = Hostel
        fields = [
            'id', 'school', 'school_name',
            'name', 'hostel_type', 'hostel_type_display',
            'warden', 'warden_name',
            'capacity', 'current_occupancy', 'rooms_count',
            'address', 'contact_number', 'is_active',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class HostelCreateSerializer(serializers.ModelSerializer):
    """Write serializer for creating/updating hostels."""

    class Meta:
        model = Hostel
        fields = [
            'id', 'name', 'hostel_type', 'warden',
            'capacity', 'address', 'contact_number', 'is_active',
        ]
        read_only_fields = ['id']


# =============================================================================
# Room Serializers
# =============================================================================

class RoomReadSerializer(serializers.ModelSerializer):
    """Read serializer with nested hostel details and occupancy info."""
    hostel_name = serializers.CharField(source='hostel.name', read_only=True)
    room_type_display = serializers.CharField(
        source='get_room_type_display', read_only=True,
    )
    current_occupancy = serializers.IntegerField(read_only=True)
    is_full = serializers.BooleanField(read_only=True)

    class Meta:
        model = Room
        fields = [
            'id', 'hostel', 'hostel_name',
            'room_number', 'floor',
            'room_type', 'room_type_display',
            'capacity', 'current_occupancy', 'is_full',
            'is_available',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class RoomCreateSerializer(serializers.ModelSerializer):
    """Write serializer for creating/updating rooms."""

    class Meta:
        model = Room
        fields = [
            'id', 'hostel', 'room_number', 'floor',
            'room_type', 'capacity', 'is_available',
        ]
        read_only_fields = ['id']

    def validate(self, attrs):
        hostel = attrs.get('hostel')
        room_number = attrs.get('room_number')

        # Check uniqueness on create (not on update if room_number unchanged)
        if hostel and room_number:
            qs = Room.objects.filter(hostel=hostel, room_number=room_number)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError({
                    'room_number': 'A room with this number already exists in this hostel.',
                })

        return attrs


# =============================================================================
# HostelAllocation Serializers
# =============================================================================

class HostelAllocationReadSerializer(serializers.ModelSerializer):
    """Read serializer with nested student, room, and hostel details."""
    student_name = serializers.CharField(source='student.name', read_only=True)
    student_roll_number = serializers.CharField(
        source='student.roll_number', read_only=True, default=None,
    )
    student_class_name = serializers.CharField(
        source='student.class_obj.name', read_only=True, default=None,
    )
    room_number = serializers.CharField(source='room.room_number', read_only=True)
    hostel_name = serializers.CharField(source='room.hostel.name', read_only=True)
    academic_year_name = serializers.CharField(
        source='academic_year.name', read_only=True,
    )

    class Meta:
        model = HostelAllocation
        fields = [
            'id', 'school',
            'student', 'student_name', 'student_roll_number', 'student_class_name',
            'room', 'room_number', 'hostel_name',
            'academic_year', 'academic_year_name',
            'allocated_date', 'vacated_date', 'is_active',
            'created_at',
        ]
        read_only_fields = ['id', 'allocated_date', 'created_at']


class HostelAllocationCreateSerializer(serializers.ModelSerializer):
    """Write serializer for creating/updating allocations."""

    class Meta:
        model = HostelAllocation
        fields = [
            'id', 'student', 'room', 'academic_year',
        ]
        read_only_fields = ['id']

    def validate(self, attrs):
        room = attrs.get('room')
        student = attrs.get('student')
        academic_year = attrs.get('academic_year')

        # Check if room is full
        if room and room.is_full:
            raise serializers.ValidationError({
                'room': 'This room is already at full capacity.',
            })

        # Check if room is available
        if room and not room.is_available:
            raise serializers.ValidationError({
                'room': 'This room is not currently available.',
            })

        # Check if student already has an active allocation for this academic year
        if student and academic_year:
            qs = HostelAllocation.objects.filter(
                student=student, academic_year=academic_year, is_active=True,
            )
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError({
                    'student': 'This student already has an active hostel allocation for this academic year.',
                })

        return attrs


# =============================================================================
# GatePass Serializers
# =============================================================================

class GatePassReadSerializer(serializers.ModelSerializer):
    """Read serializer with nested student and approval details."""
    student_name = serializers.CharField(source='student.name', read_only=True)
    student_roll_number = serializers.CharField(
        source='student.roll_number', read_only=True, default=None,
    )
    hostel_name = serializers.CharField(
        source='allocation.room.hostel.name', read_only=True,
    )
    room_number = serializers.CharField(
        source='allocation.room.room_number', read_only=True,
    )
    pass_type_display = serializers.CharField(
        source='get_pass_type_display', read_only=True,
    )
    status_display = serializers.CharField(
        source='get_status_display', read_only=True,
    )
    approved_by_name = serializers.CharField(
        source='approved_by.username', read_only=True, default=None,
    )

    class Meta:
        model = GatePass
        fields = [
            'id', 'school',
            'student', 'student_name', 'student_roll_number',
            'allocation', 'hostel_name', 'room_number',
            'pass_type', 'pass_type_display',
            'reason', 'going_to', 'contact_at_destination',
            'departure_date', 'expected_return', 'actual_return',
            'status', 'status_display',
            'approved_by', 'approved_by_name', 'approved_at',
            'remarks',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'approved_by', 'approved_at', 'actual_return',
            'created_at', 'updated_at',
        ]


class GatePassCreateSerializer(serializers.ModelSerializer):
    """Write serializer for creating gate passes."""

    class Meta:
        model = GatePass
        fields = [
            'id', 'student', 'allocation',
            'pass_type', 'reason', 'going_to',
            'contact_at_destination',
            'departure_date', 'expected_return',
        ]
        read_only_fields = ['id']

    def validate(self, attrs):
        student = attrs.get('student')
        allocation = attrs.get('allocation')

        # Ensure the allocation belongs to the student
        if student and allocation and allocation.student_id != student.id:
            raise serializers.ValidationError({
                'allocation': 'This allocation does not belong to the selected student.',
            })

        # Ensure the allocation is active
        if allocation and not allocation.is_active:
            raise serializers.ValidationError({
                'allocation': 'Cannot create a gate pass for an inactive allocation.',
            })

        # Ensure departure is before expected return
        departure = attrs.get('departure_date')
        expected_return = attrs.get('expected_return')
        if departure and expected_return and departure >= expected_return:
            raise serializers.ValidationError({
                'expected_return': 'Expected return must be after departure date.',
            })

        return attrs
