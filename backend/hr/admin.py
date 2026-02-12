from django.contrib import admin
from .models import (
    StaffDepartment, StaffDesignation, StaffMember,
    StaffQualification, StaffDocument,
    SalaryStructure, Payslip,
    LeavePolicy, LeaveApplication,
    StaffAttendance, PerformanceAppraisal,
)


@admin.register(StaffDepartment)
class StaffDepartmentAdmin(admin.ModelAdmin):
    list_display = ['name', 'school', 'is_active', 'created_at']
    list_filter = ['school', 'is_active']
    search_fields = ['name']


@admin.register(StaffDesignation)
class StaffDesignationAdmin(admin.ModelAdmin):
    list_display = ['name', 'department', 'school', 'is_active']
    list_filter = ['school', 'department', 'is_active']
    search_fields = ['name']


@admin.register(StaffMember)
class StaffMemberAdmin(admin.ModelAdmin):
    list_display = [
        'first_name', 'last_name', 'employee_id',
        'department', 'designation', 'employment_status',
        'school', 'is_active',
    ]
    list_filter = ['school', 'department', 'employment_status', 'employment_type', 'is_active']
    search_fields = ['first_name', 'last_name', 'email', 'employee_id']
    raw_id_fields = ['user', 'school']


@admin.register(StaffQualification)
class StaffQualificationAdmin(admin.ModelAdmin):
    list_display = ['staff_member', 'qualification_name', 'institution', 'year_of_completion']
    list_filter = ['qualification_type']
    search_fields = ['qualification_name', 'institution']
    raw_id_fields = ['staff_member']


@admin.register(StaffDocument)
class StaffDocumentAdmin(admin.ModelAdmin):
    list_display = ['staff_member', 'title', 'document_type', 'uploaded_at']
    list_filter = ['document_type']
    raw_id_fields = ['staff_member']


@admin.register(SalaryStructure)
class SalaryStructureAdmin(admin.ModelAdmin):
    list_display = ['staff_member', 'basic_salary', 'effective_from', 'effective_to', 'is_active']
    list_filter = ['school', 'is_active']
    raw_id_fields = ['staff_member']


@admin.register(Payslip)
class PayslipAdmin(admin.ModelAdmin):
    list_display = ['staff_member', 'month', 'year', 'net_salary', 'status']
    list_filter = ['school', 'status', 'year', 'month']
    raw_id_fields = ['staff_member']


@admin.register(LeavePolicy)
class LeavePolicyAdmin(admin.ModelAdmin):
    list_display = ['name', 'leave_type', 'days_allowed', 'school', 'is_active']
    list_filter = ['school', 'leave_type', 'is_active']


@admin.register(LeaveApplication)
class LeaveApplicationAdmin(admin.ModelAdmin):
    list_display = ['staff_member', 'leave_policy', 'start_date', 'end_date', 'status']
    list_filter = ['school', 'status']
    raw_id_fields = ['staff_member', 'approved_by']


@admin.register(StaffAttendance)
class StaffAttendanceAdmin(admin.ModelAdmin):
    list_display = ['staff_member', 'date', 'status', 'check_in', 'check_out']
    list_filter = ['school', 'status', 'date']
    raw_id_fields = ['staff_member']


@admin.register(PerformanceAppraisal)
class PerformanceAppraisalAdmin(admin.ModelAdmin):
    list_display = ['staff_member', 'review_period_start', 'review_period_end', 'rating']
    list_filter = ['school', 'rating']
    raw_id_fields = ['staff_member', 'reviewer']
