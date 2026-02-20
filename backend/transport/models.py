"""
Transport models for route, stop, vehicle, assignment, and attendance management.
"""

from django.db import models
from django.conf import settings


class TransportRoute(models.Model):
    """
    Represents a transport route operated by the school.
    Each route has a start and end location with multiple stops in between.
    """
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='transport_routes',
    )
    name = models.CharField(
        max_length=100,
        help_text="Route name, e.g. 'Route 1 - North City'",
    )
    description = models.TextField(
        blank=True,
        default='',
        help_text="Optional description of the route",
    )
    start_location = models.CharField(
        max_length=200,
        help_text="Starting point of the route",
    )
    end_location = models.CharField(
        max_length=200,
        help_text="Ending point of the route (usually the school)",
    )
    start_latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    start_longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    end_latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    end_longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    distance_km = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Total route distance in kilometers",
    )
    estimated_duration_minutes = models.PositiveIntegerField(
        help_text="Estimated travel time in minutes",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'name')
        ordering = ['name']
        verbose_name = 'Transport Route'
        verbose_name_plural = 'Transport Routes'

    def __str__(self):
        return f"{self.name} - {self.school.name}"


class TransportStop(models.Model):
    """
    Represents a stop along a transport route.
    Stops are ordered and have pickup/drop times.
    """
    route = models.ForeignKey(
        TransportRoute,
        on_delete=models.CASCADE,
        related_name='stops',
    )
    name = models.CharField(
        max_length=100,
        help_text="Stop name, e.g. 'Main Market'",
    )
    address = models.TextField(
        blank=True,
        default='',
        help_text="Full address of the stop",
    )
    latitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
        null=True,
        blank=True,
        help_text="GPS latitude",
    )
    longitude = models.DecimalField(
        max_digits=9,
        decimal_places=6,
        null=True,
        blank=True,
        help_text="GPS longitude",
    )
    stop_order = models.PositiveIntegerField(
        help_text="Order of this stop in the route (1, 2, 3, ...)",
    )
    pickup_time = models.TimeField(
        help_text="Scheduled pickup time at this stop",
    )
    drop_time = models.TimeField(
        help_text="Scheduled drop time at this stop",
    )

    class Meta:
        unique_together = ('route', 'stop_order')
        ordering = ['stop_order']
        verbose_name = 'Transport Stop'
        verbose_name_plural = 'Transport Stops'

    def __str__(self):
        return f"#{self.stop_order} {self.name} ({self.route.name})"


class TransportVehicle(models.Model):
    """
    Represents a vehicle used for school transport.
    """
    VEHICLE_TYPE_CHOICES = [
        ('BUS', 'Bus'),
        ('VAN', 'Van'),
        ('CAR', 'Car'),
    ]

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='transport_vehicles',
    )
    vehicle_number = models.CharField(
        max_length=20,
        help_text="Vehicle registration number",
    )
    vehicle_type = models.CharField(
        max_length=10,
        choices=VEHICLE_TYPE_CHOICES,
        default='BUS',
    )
    capacity = models.PositiveIntegerField(
        help_text="Maximum seating capacity",
    )
    make_model = models.CharField(
        max_length=100,
        blank=True,
        default='',
        help_text="Vehicle make and model, e.g. 'Toyota Coaster'",
    )
    driver_name = models.CharField(
        max_length=100,
        help_text="Name of the assigned driver",
    )
    driver_phone = models.CharField(
        max_length=20,
        help_text="Driver's contact phone number",
    )
    driver_license = models.CharField(
        max_length=50,
        blank=True,
        default='',
        help_text="Driver's license number",
    )
    driver_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='driven_vehicles',
        help_text="Linked driver user account (for app-based tracking)",
    )
    assigned_route = models.ForeignKey(
        TransportRoute,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='vehicles',
        help_text="Route this vehicle is currently assigned to",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'vehicle_number')
        ordering = ['vehicle_number']
        verbose_name = 'Transport Vehicle'
        verbose_name_plural = 'Transport Vehicles'

    def __str__(self):
        return f"{self.vehicle_number} ({self.get_vehicle_type_display()}) - {self.school.name}"


class TransportAssignment(models.Model):
    """
    Assigns a student to a transport route, stop, and optionally a vehicle
    for a given academic year.
    """
    TRANSPORT_TYPE_CHOICES = [
        ('PICKUP', 'Pickup Only'),
        ('DROP', 'Drop Only'),
        ('BOTH', 'Both Pickup and Drop'),
    ]

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='transport_assignments',
    )
    academic_year = models.ForeignKey(
        'academic_sessions.AcademicYear',
        on_delete=models.CASCADE,
        related_name='transport_assignments',
    )
    student = models.ForeignKey(
        'students.Student',
        on_delete=models.CASCADE,
        related_name='transport_assignments',
    )
    route = models.ForeignKey(
        TransportRoute,
        on_delete=models.CASCADE,
        related_name='transport_assignments',
    )
    stop = models.ForeignKey(
        TransportStop,
        on_delete=models.CASCADE,
        related_name='transport_assignments',
    )
    vehicle = models.ForeignKey(
        TransportVehicle,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='transport_assignments',
    )
    transport_type = models.CharField(
        max_length=10,
        choices=TRANSPORT_TYPE_CHOICES,
        default='BOTH',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('school', 'student', 'academic_year')
        ordering = ['-created_at']
        verbose_name = 'Transport Assignment'
        verbose_name_plural = 'Transport Assignments'

    def __str__(self):
        return f"{self.student.name} -> {self.route.name} ({self.academic_year.name})"


class TransportAttendance(models.Model):
    """
    Records whether a student boarded their transport on a given date.
    """
    BOARDING_STATUS_CHOICES = [
        ('BOARDED', 'Boarded'),
        ('NOT_BOARDED', 'Not Boarded'),
        ('ABSENT', 'Absent'),
    ]

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='transport_attendance_records',
    )
    student = models.ForeignKey(
        'students.Student',
        on_delete=models.CASCADE,
        related_name='transport_attendance_records',
    )
    route = models.ForeignKey(
        TransportRoute,
        on_delete=models.CASCADE,
        related_name='transport_attendance_records',
    )
    date = models.DateField(
        help_text="Date of the transport attendance record",
    )
    boarding_status = models.CharField(
        max_length=15,
        choices=BOARDING_STATUS_CHOICES,
        default='BOARDED',
    )
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='transport_attendance_recorded',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('school', 'student', 'date', 'route')
        ordering = ['-date']
        verbose_name = 'Transport Attendance'
        verbose_name_plural = 'Transport Attendance Records'

    def __str__(self):
        return f"{self.student.name} - {self.route.name} - {self.date}: {self.get_boarding_status_display()}"


class StudentJourney(models.Model):
    """Tracks a student's journey to/from school with GPS."""

    JOURNEY_TYPE_CHOICES = [
        ('TO_SCHOOL', 'To School'),
        ('FROM_SCHOOL', 'From School'),
    ]
    STATUS_CHOICES = [
        ('ACTIVE', 'Active'),
        ('COMPLETED', 'Completed'),
        ('CANCELLED', 'Cancelled'),
    ]

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='student_journeys',
    )
    student = models.ForeignKey(
        'students.Student',
        on_delete=models.CASCADE,
        related_name='journeys',
    )
    transport_assignment = models.ForeignKey(
        TransportAssignment,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='journeys',
    )
    journey_type = models.CharField(max_length=15, choices=JOURNEY_TYPE_CHOICES)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='ACTIVE')
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    start_latitude = models.DecimalField(max_digits=9, decimal_places=6)
    start_longitude = models.DecimalField(max_digits=9, decimal_places=6)
    end_latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    end_longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)

    class Meta:
        ordering = ['-started_at']
        verbose_name = 'Student Journey'
        verbose_name_plural = 'Student Journeys'

    def __str__(self):
        return f"{self.student.name} - {self.get_journey_type_display()} ({self.get_status_display()})"


class LocationUpdate(models.Model):
    """Individual GPS ping during a student journey."""

    journey = models.ForeignKey(
        StudentJourney,
        on_delete=models.CASCADE,
        related_name='locations',
    )
    latitude = models.DecimalField(max_digits=9, decimal_places=6)
    longitude = models.DecimalField(max_digits=9, decimal_places=6)
    accuracy = models.FloatField(help_text='GPS accuracy in meters')
    speed = models.FloatField(null=True, blank=True, help_text='Speed in m/s')
    battery_level = models.IntegerField(null=True, blank=True, help_text='Battery % (0-100)')
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['journey', '-timestamp']),
        ]
        verbose_name = 'Location Update'
        verbose_name_plural = 'Location Updates'

    def __str__(self):
        return f"({self.latitude}, {self.longitude}) at {self.timestamp}"


class RouteJourney(models.Model):
    """
    Tracks a driver/vehicle journey along a route.
    Supports multiple tracking modes: driver app GPS, admin manual updates,
    or hardware GPS device integration.
    """

    JOURNEY_TYPE_CHOICES = [
        ('TO_SCHOOL', 'To School'),
        ('FROM_SCHOOL', 'From School'),
    ]
    STATUS_CHOICES = [
        ('ACTIVE', 'Active'),
        ('COMPLETED', 'Completed'),
        ('CANCELLED', 'Cancelled'),
    ]
    TRACKING_MODE_CHOICES = [
        ('DRIVER_APP', 'Driver App'),
        ('MANUAL', 'Manual (Admin)'),
        ('HARDWARE_GPS', 'Hardware GPS Device'),
    ]

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='route_journeys',
    )
    route = models.ForeignKey(
        TransportRoute,
        on_delete=models.CASCADE,
        related_name='route_journeys',
    )
    vehicle = models.ForeignKey(
        TransportVehicle,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='route_journeys',
    )
    driver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='route_journeys',
    )
    journey_type = models.CharField(max_length=15, choices=JOURNEY_TYPE_CHOICES)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='ACTIVE')
    tracking_mode = models.CharField(max_length=15, choices=TRACKING_MODE_CHOICES, default='DRIVER_APP')
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    start_latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    start_longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    end_latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    end_longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    notified_stops = models.JSONField(
        default=list,
        blank=True,
        help_text="List of stop IDs that have triggered geofence notifications this journey",
    )

    class Meta:
        ordering = ['-started_at']
        indexes = [
            models.Index(fields=['school', 'status']),
        ]
        verbose_name = 'Route Journey'
        verbose_name_plural = 'Route Journeys'

    def __str__(self):
        return f"{self.route.name} - {self.get_journey_type_display()} ({self.get_status_display()})"


class RouteLocationUpdate(models.Model):
    """Individual GPS ping during a route journey (driver/vehicle tracking)."""

    SOURCE_CHOICES = [
        ('APP', 'Driver App'),
        ('HARDWARE', 'Hardware GPS'),
        ('MANUAL', 'Manual Entry'),
    ]

    journey = models.ForeignKey(
        RouteJourney,
        on_delete=models.CASCADE,
        related_name='locations',
    )
    latitude = models.DecimalField(max_digits=9, decimal_places=6)
    longitude = models.DecimalField(max_digits=9, decimal_places=6)
    accuracy = models.FloatField(help_text='GPS accuracy in meters', default=0)
    speed = models.FloatField(null=True, blank=True, help_text='Speed in m/s')
    battery_level = models.IntegerField(null=True, blank=True, help_text='Battery % (0-100)')
    source = models.CharField(max_length=10, choices=SOURCE_CHOICES, default='APP')
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['journey', '-timestamp']),
        ]
        verbose_name = 'Route Location Update'
        verbose_name_plural = 'Route Location Updates'

    def __str__(self):
        return f"({self.latitude}, {self.longitude}) at {self.timestamp}"
