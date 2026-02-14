"""
Hostel management models: hostels, rooms, allocations, and gate passes.
"""

from django.db import models
from django.conf import settings


class Hostel(models.Model):
    """A hostel/dormitory building."""
    HOSTEL_TYPES = [('BOYS', 'Boys'), ('GIRLS', 'Girls'), ('MIXED', 'Mixed')]

    school = models.ForeignKey(
        'schools.School', on_delete=models.CASCADE, related_name='hostels',
    )
    name = models.CharField(max_length=100)
    hostel_type = models.CharField(max_length=10, choices=HOSTEL_TYPES)
    warden = models.ForeignKey(
        'hr.StaffMember', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='warden_of',
    )
    capacity = models.PositiveIntegerField(default=0)
    address = models.TextField(blank=True, default='')
    contact_number = models.CharField(max_length=20, blank=True, default='')
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'name')
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.get_hostel_type_display()})"

    @property
    def current_occupancy(self):
        return HostelAllocation.objects.filter(
            room__hostel=self, is_active=True,
        ).count()


class Room(models.Model):
    """A room within a hostel."""
    ROOM_TYPES = [
        ('SINGLE', 'Single'),
        ('DOUBLE', 'Double'),
        ('DORMITORY', 'Dormitory'),
    ]

    hostel = models.ForeignKey(
        Hostel, on_delete=models.CASCADE, related_name='rooms',
    )
    room_number = models.CharField(max_length=20)
    floor = models.PositiveIntegerField(default=0)
    room_type = models.CharField(max_length=20, choices=ROOM_TYPES, default='DOUBLE')
    capacity = models.PositiveIntegerField(default=2)
    is_available = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('hostel', 'room_number')
        ordering = ['hostel', 'floor', 'room_number']

    def __str__(self):
        return f"{self.hostel.name} - {self.room_number}"

    @property
    def current_occupancy(self):
        return self.allocations.filter(is_active=True).count()

    @property
    def is_full(self):
        return self.current_occupancy >= self.capacity


class HostelAllocation(models.Model):
    """Student assigned to a room for an academic year."""
    school = models.ForeignKey(
        'schools.School', on_delete=models.CASCADE,
        related_name='hostel_allocations',
    )
    student = models.ForeignKey(
        'students.Student', on_delete=models.CASCADE,
        related_name='hostel_allocations',
    )
    room = models.ForeignKey(
        Room, on_delete=models.CASCADE, related_name='allocations',
    )
    academic_year = models.ForeignKey(
        'academic_sessions.AcademicYear', on_delete=models.CASCADE,
    )
    allocated_date = models.DateField(auto_now_add=True)
    vacated_date = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('student', 'academic_year')
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.student} -> {self.room}"


class GatePass(models.Model):
    """Gate pass for student leaving hostel premises."""
    STATUS_CHOICES = [
        ('PENDING', 'Pending Approval'),
        ('APPROVED', 'Approved'),
        ('REJECTED', 'Rejected'),
        ('USED', 'Checked Out'),
        ('RETURNED', 'Returned'),
        ('EXPIRED', 'Expired'),
    ]
    PASS_TYPES = [
        ('DAY', 'Day Pass'),
        ('OVERNIGHT', 'Overnight'),
        ('WEEKEND', 'Weekend'),
        ('VACATION', 'Vacation Leave'),
    ]

    school = models.ForeignKey(
        'schools.School', on_delete=models.CASCADE,
        related_name='gate_passes',
    )
    student = models.ForeignKey(
        'students.Student', on_delete=models.CASCADE,
        related_name='gate_passes',
    )
    allocation = models.ForeignKey(
        HostelAllocation, on_delete=models.CASCADE,
        related_name='gate_passes',
    )
    pass_type = models.CharField(max_length=20, choices=PASS_TYPES)
    reason = models.TextField()
    going_to = models.CharField(max_length=200)
    contact_at_destination = models.CharField(max_length=20, blank=True, default='')
    departure_date = models.DateTimeField()
    expected_return = models.DateTimeField()
    actual_return = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='approved_gate_passes',
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    remarks = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.student} - {self.get_pass_type_display()} ({self.get_status_display()})"
