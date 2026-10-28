"""
Transport serializers with Read (nested details) and Create (flat IDs) pattern.
"""

from rest_framework import serializers
from .models import (
    TransportRoute, TransportStop, TransportVehicle,
    TransportAssignment, TransportAttendance,
    StudentJourney, LocationUpdate,
    RouteJourney, RouteLocationUpdate,
)

from .utils import resolve_school_id


class SchoolScopedMixin:
    """Helpers for write serializers: the models' unique constraints include
    `school`, which is not a serializer field, so DRF adds no validator for
    them and a duplicate surfaced as a 500 IntegrityError."""

    def _school_id(self):
        request = self.context.get('request')
        return resolve_school_id(request) if request else None

    def _check_school(self, obj, field, label):
        """Reject a related object that belongs to another school."""
        school_id = self._school_id()
        if obj is None or not school_id:
            return
        owner = getattr(obj, 'school_id', None)
        if owner is None and hasattr(obj, 'route'):
            owner = obj.route.school_id
        if owner != school_id:
            raise serializers.ValidationError({field: f'Selected {label} does not belong to this school.'})


# =============================================================================
# TransportRoute Serializers
# =============================================================================

class TransportRouteReadSerializer(serializers.ModelSerializer):
    """Read serializer with computed counts for stops, vehicles, and students."""
    school_name = serializers.CharField(source='school.name', read_only=True)
    stops_count = serializers.IntegerField(read_only=True, default=0)
    vehicles_count = serializers.IntegerField(read_only=True, default=0)
    students_count = serializers.IntegerField(read_only=True, default=0)
    total_capacity = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = TransportRoute
        fields = [
            'id', 'school', 'school_name',
            'name', 'description',
            'start_location', 'end_location',
            'start_latitude', 'start_longitude',
            'end_latitude', 'end_longitude',
            'distance_km', 'estimated_duration_minutes',
            'is_active',
            'stops_count', 'vehicles_count', 'students_count', 'total_capacity',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class TransportRouteCreateSerializer(SchoolScopedMixin, serializers.ModelSerializer):
    """Write serializer for creating/updating routes."""

    def validate_name(self, value):
        school_id = self._school_id()
        qs = TransportRoute.objects.filter(school_id=school_id, name=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if school_id and qs.exists():
            raise serializers.ValidationError('A route with this name already exists.')
        return value

    class Meta:
        model = TransportRoute
        fields = [
            'id', 'name', 'description',
            'start_location', 'end_location',
            'start_latitude', 'start_longitude',
            'end_latitude', 'end_longitude',
            'distance_km', 'estimated_duration_minutes',
            'is_active',
        ]
        read_only_fields = ['id']


# =============================================================================
# TransportStop Serializers
# =============================================================================

class TransportStopSerializer(SchoolScopedMixin, serializers.ModelSerializer):
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

    def validate(self, attrs):
        route = attrs.get('route') or getattr(self.instance, 'route', None)
        self._check_school(route, 'route', 'route')
        return attrs


# =============================================================================
# TransportVehicle Serializers
# =============================================================================

class TransportVehicleReadSerializer(serializers.ModelSerializer):
    """Read serializer with nested route name and driver user info."""
    school_name = serializers.CharField(source='school.name', read_only=True)
    route_name = serializers.CharField(
        source='assigned_route.name', read_only=True, default=None
    )
    vehicle_type_display = serializers.CharField(
        source='get_vehicle_type_display', read_only=True
    )
    driver_user_name = serializers.CharField(
        source='driver_user.get_full_name', read_only=True, default=None
    )

    class Meta:
        model = TransportVehicle
        fields = [
            'id', 'school', 'school_name',
            'vehicle_number', 'vehicle_type', 'vehicle_type_display',
            'capacity', 'make_model',
            'driver_name', 'driver_phone', 'driver_license',
            'driver_user', 'driver_user_name',
            'assigned_route', 'route_name',
            'is_active',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class TransportVehicleCreateSerializer(SchoolScopedMixin, serializers.ModelSerializer):
    """Write serializer for creating/updating vehicles."""

    def validate_vehicle_number(self, value):
        school_id = self._school_id()
        qs = TransportVehicle.objects.filter(school_id=school_id, vehicle_number=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if school_id and qs.exists():
            raise serializers.ValidationError('A vehicle with this number already exists.')
        return value

    def validate(self, attrs):
        self._check_school(attrs.get('assigned_route'), 'assigned_route', 'route')
        return attrs

    class Meta:
        model = TransportVehicle
        fields = [
            'id', 'vehicle_number', 'vehicle_type',
            'capacity', 'make_model',
            'driver_name', 'driver_phone', 'driver_license',
            'driver_user', 'assigned_route', 'is_active',
        ]
        read_only_fields = ['id']


# =============================================================================
# TransportAssignment Serializers
# =============================================================================

class TransportAssignmentReadSerializer(serializers.ModelSerializer):
    """Read serializer with nested student, route, stop, and vehicle names."""
    student_name = serializers.CharField(source='student.name', read_only=True)
    student_roll_number = serializers.SerializerMethodField()
    student_class_name = serializers.SerializerMethodField()
    route_name = serializers.CharField(source='route.name', read_only=True)
    stop_name = serializers.CharField(source='stop.name', read_only=True)
    stop_pickup_time = serializers.TimeField(source='stop.pickup_time', read_only=True, default=None)
    stop_drop_time = serializers.TimeField(source='stop.drop_time', read_only=True, default=None)
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
            'stop', 'stop_name', 'stop_pickup_time', 'stop_drop_time',
            'vehicle', 'vehicle_number',
            'transport_type', 'transport_type_display',
            'is_active',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def get_student_roll_number(self, obj):
        from academic_sessions.roster import placement_roll, serializer_placement

        return placement_roll(serializer_placement(self, obj, lambda a: a.academic_year_id), obj.student)

    def get_student_class_name(self, obj):
        from academic_sessions.roster import placement_label, serializer_placement

        return placement_label(serializer_placement(self, obj, lambda a: a.academic_year_id), obj.student) or None


class TransportAssignmentCreateSerializer(SchoolScopedMixin, serializers.ModelSerializer):
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
        for field, label in (('academic_year', 'academic year'), ('student', 'student'),
                             ('route', 'route'), ('stop', 'stop'), ('vehicle', 'vehicle')):
            self._check_school(attrs.get(field), field, label)

        student = attrs.get('student') or getattr(self.instance, 'student', None)
        year = attrs.get('academic_year') or getattr(self.instance, 'academic_year', None)
        school_id = self._school_id()
        if school_id and student and year:
            dupes = TransportAssignment.objects.filter(
                school_id=school_id, student=student, academic_year=year,
            )
            if self.instance:
                dupes = dupes.exclude(pk=self.instance.pk)
            if dupes.exists():
                raise serializers.ValidationError({
                    'student': 'This student already has a transport assignment for this academic year.'
                })

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
    student_roll_number = serializers.SerializerMethodField()
    student_class_name = serializers.SerializerMethodField()
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

    # No year on attendance rows: the current year's placement.
    def get_student_roll_number(self, obj):
        from academic_sessions.roster import placement_roll, serializer_placement

        return placement_roll(serializer_placement(self, obj), obj.student)

    def get_student_class_name(self, obj):
        from academic_sessions.roster import placement_label, serializer_placement

        return placement_label(serializer_placement(self, obj), obj.student) or None


class TransportAttendanceCreateSerializer(SchoolScopedMixin, serializers.ModelSerializer):
    """Write serializer for creating attendance records."""

    class Meta:
        model = TransportAttendance
        fields = [
            'id', 'student', 'route', 'date', 'boarding_status',
        ]
        read_only_fields = ['id']

    def validate(self, attrs):
        self._check_school(attrs.get('student'), 'student', 'student')
        self._check_school(attrs.get('route'), 'route', 'route')
        student = attrs.get('student') or getattr(self.instance, 'student', None)
        route = attrs.get('route') or getattr(self.instance, 'route', None)
        day = attrs.get('date') or getattr(self.instance, 'date', None)
        school_id = self._school_id()
        if school_id and student and route and day:
            dupes = TransportAttendance.objects.filter(
                school_id=school_id, student=student, route=route, date=day,
            )
            if self.instance:
                dupes = dupes.exclude(pk=self.instance.pk)
            if dupes.exists():
                raise serializers.ValidationError(
                    'Attendance for this student, route and date is already recorded.'
                )
        return attrs


# =============================================================================
# Bulk Transport Attendance Serializer
# =============================================================================

class BulkTransportAttendanceItemSerializer(serializers.Serializer):
    """Single item within a bulk attendance marking request."""
    student_id = serializers.IntegerField()
    boarding_status = serializers.ChoiceField(
        choices=['BOARDED', 'NOT_BOARDED', 'ABSENT']
    )


class DriverBoardingSerializer(serializers.Serializer):
    """A driver's boarding marks: no route (it comes from their vehicle) and, if a date is sent,
    the view insists on today."""
    date = serializers.DateField(required=False)
    records = BulkTransportAttendanceItemSerializer(many=True)

    def validate_records(self, value):
        if not value:
            raise serializers.ValidationError("At least one attendance record is required.")
        return value


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


# =============================================================================
# Route Journey Serializers (driver/vehicle-centric tracking)
# =============================================================================

class RouteLocationUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = RouteLocationUpdate
        fields = ['id', 'latitude', 'longitude', 'accuracy', 'speed', 'battery_level', 'source', 'timestamp']
        read_only_fields = ['id', 'timestamp']


class RouteJourneyReadSerializer(serializers.ModelSerializer):
    route_name = serializers.CharField(source='route.name', read_only=True)
    vehicle_number = serializers.CharField(source='vehicle.vehicle_number', read_only=True, default=None)
    driver_name = serializers.SerializerMethodField()
    journey_type_display = serializers.CharField(source='get_journey_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    tracking_mode_display = serializers.CharField(source='get_tracking_mode_display', read_only=True)
    latest_location = serializers.SerializerMethodField()

    class Meta:
        model = RouteJourney
        fields = [
            'id', 'school', 'route', 'route_name',
            'vehicle', 'vehicle_number',
            'driver', 'driver_name',
            'journey_type', 'journey_type_display',
            'status', 'status_display',
            'tracking_mode', 'tracking_mode_display',
            'started_at', 'ended_at',
            'start_latitude', 'start_longitude',
            'end_latitude', 'end_longitude',
            'latest_location',
        ]

    def get_driver_name(self, obj):
        if obj.driver:
            full = obj.driver.get_full_name()
            return full if full.strip() else obj.driver.username
        return None

    def get_latest_location(self, obj):
        loc = obj.locations.first()
        if loc:
            return RouteLocationUpdateSerializer(loc).data
        return None


class RouteJourneyCreateSerializer(serializers.Serializer):
    journey_type = serializers.ChoiceField(choices=[('TO_SCHOOL', 'To School'), ('FROM_SCHOOL', 'From School')])
    latitude = serializers.DecimalField(max_digits=9, decimal_places=6, required=False, allow_null=True)
    longitude = serializers.DecimalField(max_digits=9, decimal_places=6, required=False, allow_null=True)
    route_id = serializers.IntegerField(required=False, help_text='Required for admin manual mode')


class RouteJourneyUpdateSerializer(serializers.Serializer):
    journey_id = serializers.IntegerField()
    latitude = serializers.DecimalField(max_digits=9, decimal_places=6)
    longitude = serializers.DecimalField(max_digits=9, decimal_places=6)
    accuracy = serializers.FloatField(default=0)
    speed = serializers.FloatField(required=False, allow_null=True)
    battery_level = serializers.IntegerField(required=False, allow_null=True)
