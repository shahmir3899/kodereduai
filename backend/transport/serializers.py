"""
Transport serializers with Read (nested details) and Create (flat IDs) pattern.
"""

from rest_framework import serializers
from .models import (
    TransportRoute, TransportStop, TransportVehicle,
    TransportAssignment, TransportAttendance,
    StudentJourney, LocationUpdate,
)


# =============================================================================
# TransportRoute Serializers
# =============================================================================

class TransportRouteReadSerializer(serializers.ModelSerializer):
    """Read serializer with computed counts for stops, vehicles, and students."""
    school_name = serializers.CharField(source='school.name', read_only=True)
    stops_count = serializers.IntegerField(source='stops.count', read_only=True)
    vehicles_count = serializers.SerializerMethodField()
    students_count = serializers.SerializerMethodField()

    class Meta:
        model = TransportRoute
        fields = [
            'id', 'school', 'school_name',
            'name', 'description',
            'start_location', 'end_location',
            'distance_km', 'estimated_duration_minutes',
            'is_active',
            'stops_count', 'vehicles_count', 'students_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_vehicles_count(self, obj):
        return obj.vehicles.filter(is_active=True).count()

    def get_students_count(self, obj):
        return obj.transport_assignments.filter(is_active=True).count()


class TransportRouteCreateSerializer(serializers.ModelSerializer):
    """Write serializer for creating/updating routes."""

    class Meta:
        model = TransportRoute
        fields = [
            'id', 'name', 'description',
            'start_location', 'end_location',
            'distance_km', 'estimated_duration_minutes',
            'is_active',
        ]
        read_only_fields = ['id']


# =============================================================================
# TransportStop Serializers
# =============================================================================

class TransportStopSerializer(serializers.ModelSerializer):
    """
    Flat serializer used for both read and write operations.
    Includes route_name for display.
    """
    route_name = serializers.CharField(source='route.name', read_only=True)

    class Meta:
        model = TransportStop
        fields = [
            'id', 'route', 'route_name',
            'name', 'address',
            'latitude', 'longitude',
            'stop_order',
            'pickup_time', 'drop_time',
        ]
        read_only_fields = ['id']


# =============================================================================
# TransportVehicle Serializers
# =============================================================================

class TransportVehicleReadSerializer(serializers.ModelSerializer):
    """Read serializer with nested route name."""
    school_name = serializers.CharField(source='school.name', read_only=True)
    route_name = serializers.CharField(
        source='assigned_route.name', read_only=True, default=None
    )
    vehicle_type_display = serializers.CharField(
        source='get_vehicle_type_display', read_only=True
    )

    class Meta:
        model = TransportVehicle
        fields = [
            'id', 'school', 'school_name',
            'vehicle_number', 'vehicle_type', 'vehicle_type_display',
            'capacity', 'make_model',
            'driver_name', 'driver_phone', 'driver_license',
            'assigned_route', 'route_name',
            'is_active',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class TransportVehicleCreateSerializer(serializers.ModelSerializer):
    """Write serializer for creating/updating vehicles."""

    class Meta:
        model = TransportVehicle
        fields = [
            'id', 'vehicle_number', 'vehicle_type',
            'capacity', 'make_model',
            'driver_name', 'driver_phone', 'driver_license',
            'assigned_route', 'is_active',
        ]
        read_only_fields = ['id']


# =============================================================================
# TransportAssignment Serializers
# =============================================================================

class TransportAssignmentReadSerializer(serializers.ModelSerializer):
    """Read serializer with nested student, route, stop, and vehicle names."""
    student_name = serializers.CharField(source='student.name', read_only=True)
    student_roll_number = serializers.CharField(
        source='student.roll_number', read_only=True
    )
    student_class_name = serializers.CharField(
        source='student.class_obj.name', read_only=True, default=None
    )
    route_name = serializers.CharField(source='route.name', read_only=True)
    stop_name = serializers.CharField(source='stop.name', read_only=True)
    vehicle_number = serializers.CharField(
        source='vehicle.vehicle_number', read_only=True, default=None
    )
    academic_year_name = serializers.CharField(
        source='academic_year.name', read_only=True
    )
    transport_type_display = serializers.CharField(
        source='get_transport_type_display', read_only=True
    )

    class Meta:
        model = TransportAssignment
        fields = [
            'id', 'school',
            'academic_year', 'academic_year_name',
            'student', 'student_name', 'student_roll_number', 'student_class_name',
            'route', 'route_name',
            'stop', 'stop_name',
            'vehicle', 'vehicle_number',
            'transport_type', 'transport_type_display',
            'is_active',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class TransportAssignmentCreateSerializer(serializers.ModelSerializer):
    """Write serializer for creating/updating assignments."""

    class Meta:
        model = TransportAssignment
        fields = [
            'id', 'academic_year', 'student',
            'route', 'stop', 'vehicle',
            'transport_type', 'is_active',
        ]
        read_only_fields = ['id']

    def validate(self, attrs):
        # Ensure the stop belongs to the selected route
        route = attrs.get('route')
        stop = attrs.get('stop')
        if route and stop and stop.route_id != route.id:
            raise serializers.ValidationError({
                'stop': 'The selected stop does not belong to the selected route.'
            })

        # Ensure the vehicle (if provided) is assigned to the same route
        vehicle = attrs.get('vehicle')
        if vehicle and route and vehicle.assigned_route_id and vehicle.assigned_route_id != route.id:
            raise serializers.ValidationError({
                'vehicle': 'The selected vehicle is not assigned to the selected route.'
            })

        return attrs


# =============================================================================
# TransportAttendance Serializers
# =============================================================================

class TransportAttendanceReadSerializer(serializers.ModelSerializer):
    """Read serializer with nested student and route details."""
    student_name = serializers.CharField(source='student.name', read_only=True)
    student_roll_number = serializers.CharField(
        source='student.roll_number', read_only=True
    )
    student_class_name = serializers.CharField(
        source='student.class_obj.name', read_only=True, default=None
    )
    route_name = serializers.CharField(source='route.name', read_only=True)
    boarding_status_display = serializers.CharField(
        source='get_boarding_status_display', read_only=True
    )
    recorded_by_name = serializers.CharField(
        source='recorded_by.username', read_only=True, default=None
    )

    class Meta:
        model = TransportAttendance
        fields = [
            'id', 'school',
            'student', 'student_name', 'student_roll_number', 'student_class_name',
            'route', 'route_name',
            'date', 'boarding_status', 'boarding_status_display',
            'recorded_by', 'recorded_by_name',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class TransportAttendanceCreateSerializer(serializers.ModelSerializer):
    """Write serializer for creating attendance records."""

    class Meta:
        model = TransportAttendance
        fields = [
            'id', 'student', 'route', 'date', 'boarding_status',
        ]
        read_only_fields = ['id']


# =============================================================================
# Bulk Transport Attendance Serializer
# =============================================================================

class BulkTransportAttendanceItemSerializer(serializers.Serializer):
    """Single item within a bulk attendance marking request."""
    student_id = serializers.IntegerField()
    boarding_status = serializers.ChoiceField(
        choices=['BOARDED', 'NOT_BOARDED', 'ABSENT']
    )


class BulkTransportAttendanceSerializer(serializers.Serializer):
    """
    Serializer for bulk marking transport attendance.
    Expects a route_id, date, and a list of student attendance records.
    """
    route_id = serializers.IntegerField()
    date = serializers.DateField()
    records = BulkTransportAttendanceItemSerializer(many=True)

    def validate_records(self, value):
        if not value:
            raise serializers.ValidationError("At least one attendance record is required.")
        return value


# =============================================================================
# GPS Journey Serializers
# =============================================================================

class LocationUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = LocationUpdate
        fields = ['id', 'latitude', 'longitude', 'accuracy', 'speed', 'battery_level', 'timestamp']
        read_only_fields = ['id', 'timestamp']


class StudentJourneyReadSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source='student.name', read_only=True)
    latest_location = serializers.SerializerMethodField()

    class Meta:
        model = StudentJourney
        fields = [
            'id', 'school', 'student', 'student_name',
            'transport_assignment', 'journey_type', 'status',
            'started_at', 'ended_at',
            'start_latitude', 'start_longitude',
            'end_latitude', 'end_longitude',
            'latest_location',
        ]

    def get_latest_location(self, obj):
        loc = obj.locations.first()
        if loc:
            return LocationUpdateSerializer(loc).data
        return None


class JourneyStartSerializer(serializers.Serializer):
    journey_type = serializers.ChoiceField(choices=[('TO_SCHOOL', 'To School'), ('FROM_SCHOOL', 'From School')])
    latitude = serializers.DecimalField(max_digits=9, decimal_places=6)
    longitude = serializers.DecimalField(max_digits=9, decimal_places=6)


class JourneyUpdateSerializer(serializers.Serializer):
    journey_id = serializers.IntegerField()
    latitude = serializers.DecimalField(max_digits=9, decimal_places=6)
    longitude = serializers.DecimalField(max_digits=9, decimal_places=6)
    accuracy = serializers.FloatField()
    speed = serializers.FloatField(required=False, allow_null=True)
    battery_level = serializers.IntegerField(required=False, allow_null=True)
