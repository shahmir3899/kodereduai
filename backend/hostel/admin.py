from django.contrib import admin
from .models import Hostel, Room, HostelAllocation, GatePass


@admin.register(Hostel)
class HostelAdmin(admin.ModelAdmin):
    list_display = ('name', 'school', 'hostel_type', 'capacity', 'is_active')
    list_filter = ('hostel_type', 'is_active', 'school')
    search_fields = ('name',)


@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ('room_number', 'hostel', 'floor', 'room_type', 'capacity', 'is_available')
    list_filter = ('room_type', 'is_available', 'hostel')
    search_fields = ('room_number',)


@admin.register(HostelAllocation)
class HostelAllocationAdmin(admin.ModelAdmin):
    list_display = ('student', 'room', 'academic_year', 'is_active', 'allocated_date')
    list_filter = ('is_active', 'academic_year')
    search_fields = ('student__name',)


@admin.register(GatePass)
class GatePassAdmin(admin.ModelAdmin):
    list_display = ('student', 'pass_type', 'status', 'departure_date', 'expected_return')
    list_filter = ('status', 'pass_type')
    search_fields = ('student__name', 'going_to')
