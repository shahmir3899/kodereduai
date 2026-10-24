"""
Hostel serializers with Read (nested details) and Create (flat IDs) pattern.
"""

from rest_framework import serializers

from core.mixins import ensure_tenant_school_id

from .models import Hostel, Room, HostelAllocation, GatePass


def _check_school(serializer, attrs, checks):
    """
    Ids come straight from the request body, so a record from another school
    would otherwise be accepted. `checks` maps field -> dotted path to the
    school id on the related object.
    """
    request = serializer.context.get('request')
    school_id = ensure_tenant_school_id(request) if request else None
    if not school_id:
        return
    errors = {}
    for field, path in checks.items():
        obj = attrs.get(field)
        if obj is None:
            continue
        value = obj
        for part in path.split('.'):
            value = getattr(value, part, None)
        if value is not None and value != school_id:
            errors[field] = 'This record does not belong to the active school.'
    if errors:
        raise serializers.ValidationError(errors)


def _annotated(obj, name, fallback):
    """List views annotate counts; single-object paths fall back to the property."""
    value = getattr(obj, name, None)
    return fallback() if value is None else value


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
    current_occupancy = serializers.SerializerMethodField()
    rooms_count = serializers.SerializerMethodField()

    def get_current_occupancy(self, obj):
        return _annotated(obj, 'occupied_count', lambda: obj.current_occupancy)

    def get_rooms_count(self, obj):
        return _annotated(obj, 'room_total', lambda: obj.rooms.count())

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

    def validate(self, attrs):
        _check_school(self, attrs, {'warden': 'school_id'})
        return attrs


# =============================================================================
# Room Serializers
# =============================================================================

class RoomReadSerializer(serializers.ModelSerializer):
    """Read serializer with nested hostel details and occupancy info."""
    hostel_name = serializers.CharField(source='hostel.name', read_only=True)
    room_type_display = serializers.CharField(
        source='get_room_type_display', read_only=True,
    )
    current_occupancy = serializers.SerializerMethodField()
    is_full = serializers.SerializerMethodField()

    def get_current_occupancy(self, obj):
        return _annotated(obj, 'occupied_count', lambda: obj.current_occupancy)

    def get_is_full(self, obj):
        return self.get_current_occupancy(obj) >= obj.capacity

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
        _check_school(self, attrs, {'hostel': 'school_id'})
        hostel = attrs.get('hostel')
        room_number = attrs.get('room_number')

        capacity = attrs.get('capacity')
        if capacity is not None:
            if capacity < 1:
                raise serializers.ValidationError({'capacity': 'Capacity must be at least 1.'})
            if self.instance and capacity < self.instance.current_occupancy:
                raise serializers.ValidationError({
                    'capacity': (
                        f'This room has {self.instance.current_occupancy} students; '
                        'vacate some before lowering the capacity.'
                    ),
                })

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
    student_roll_number = serializers.SerializerMethodField()
    student_class_name = serializers.SerializerMethodField()
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

    def get_student_roll_number(self, obj):
        from academic_sessions.roster import placement_roll, serializer_placement

        return placement_roll(serializer_placement(self, obj, lambda a: a.academic_year_id), obj.student)

    def get_student_class_name(self, obj):
        from academic_sessions.roster import placement_label, serializer_placement

        return placement_label(serializer_placement(self, obj, lambda a: a.academic_year_id), obj.student) or None


class HostelAllocationCreateSerializer(serializers.ModelSerializer):
    """Write serializer for creating/updating allocations."""

    class Meta:
        model = HostelAllocation
        fields = [
            'id', 'student', 'room', 'academic_year',
        ]
        read_only_fields = ['id']
        # unique_together (student, year) would reject a vacated student with a
        # generic message; validate() and create() handle that case explicitly.
        validators = []

    def validate(self, attrs):
        _check_school(self, attrs, {
            'student': 'school_id',
            'room': 'hostel.school_id',
            'academic_year': 'school_id',
        })
        room = attrs.get('room')
        student = attrs.get('student')
        academic_year = attrs.get('academic_year')

        if room and not room.is_available:
            raise serializers.ValidationError({
                'room': 'This room is not currently available.',
            })

        # Moving within the same room must not count the student against it twice.
        if room:
            occupied = room.current_occupancy
            if self.instance and self.instance.is_active and self.instance.room_id == room.id:
                occupied -= 1
            if occupied >= room.capacity:
                raise serializers.ValidationError({
                    'room': 'This room is already at full capacity.',
                })

        if student and academic_year:
            same = HostelAllocation.objects.filter(student=student, academic_year=academic_year)
            if self.instance:
                same = same.exclude(pk=self.instance.pk)
            if same.filter(is_active=True).exists():
                raise serializers.ValidationError({
                    'student': 'This student already has an active hostel allocation for this academic year.',
                })
            if self.instance and same.exists():
                raise serializers.ValidationError({
                    'student': 'This student already has a hostel record for that academic year.',
                })

        return attrs

    def create(self, validated_data):
        # A vacated student can be placed again in the same year: reuse the old row
        # (the database allows one allocation per student and year).
        previous = HostelAllocation.objects.filter(
            student=validated_data['student'],
            academic_year=validated_data['academic_year'],
            is_active=False,
        ).first()
        if previous:
            previous.room = validated_data['room']
            previous.is_active = True
            previous.vacated_date = None
            previous.save()
            return previous
        return super().create(validated_data)


# =============================================================================
# GatePass Serializers
# =============================================================================

class GatePassReadSerializer(serializers.ModelSerializer):
    """Read serializer with nested student and approval details."""
    student_name = serializers.CharField(source='student.name', read_only=True)
    student_roll_number = serializers.SerializerMethodField()
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

    def get_student_roll_number(self, obj):
        from academic_sessions.roster import placement_roll, serializer_placement

        placement = serializer_placement(
            self, obj, lambda g: g.allocation.academic_year_id if g.allocation_id else None,
        )
        return placement_roll(placement, obj.student)


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
        _check_school(self, attrs, {'student': 'school_id', 'allocation': 'school_id'})
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
