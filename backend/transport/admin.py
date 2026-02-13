from django.contrib import admin
from .models import (
    TransportRoute, TransportStop, TransportVehicle,
    TransportAssignment, TransportAttendance,
)


class TransportStopInline(admin.TabularInline):
    model = TransportStop
    extra = 0
    ordering = ['stop_order']


@admin.register(TransportRoute)
class TransportRouteAdmin(admin.ModelAdmin):
    list_display = ['name', 'school', 'start_location', 'end_location', 'distance_km', 'is_active']
    list_filter = ['school', 'is_active']
    search_fields = ['name', 'start_location', 'end_location']
    inlines = [TransportStopInline]


@admin.register(TransportStop)
class TransportStopAdmin(admin.ModelAdmin):
    list_display = ['name', 'route', 'stop_order', 'pickup_time', 'drop_time']
    list_filter = ['route__school', 'route']
    search_fields = ['name', 'address']
    ordering = ['route', 'stop_order']


@admin.register(TransportVehicle)
class TransportVehicleAdmin(admin.ModelAdmin):
    list_display = [
        'vehicle_number', 'school', 'vehicle_type', 'capacity',
        'driver_name', 'assigned_route', 'is_active',
    ]
    list_filter = ['school', 'vehicle_type', 'is_active']
    search_fields = ['vehicle_number', 'driver_name', 'driver_phone', 'make_model']


@admin.register(TransportAssignment)
class TransportAssignmentAdmin(admin.ModelAdmin):
    list_display = [
        'student', 'school', 'academic_year', 'route',
        'stop', 'vehicle', 'transport_type', 'is_active',
    ]
    list_filter = ['school', 'academic_year', 'route', 'transport_type', 'is_active']
    search_fields = ['student__name', 'route__name']
    raw_id_fields = ['student']


@admin.register(TransportAttendance)
class TransportAttendanceAdmin(admin.ModelAdmin):
    list_display = ['student', 'school', 'route', 'date', 'boarding_status', 'recorded_by']
    list_filter = ['school', 'route', 'boarding_status', 'date']
    search_fields = ['student__name', 'route__name']
    raw_id_fields = ['student']
    date_hierarchy = 'date'
