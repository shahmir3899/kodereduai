from rest_framework import serializers
from .models import (
    StaffDepartment, StaffDesignation, StaffMember,
    StaffQualification, StaffDocument,
    SalaryStructure, Payslip,
    LeavePolicy, LeaveApplication,
    StaffAttendance, PerformanceAppraisal,
)
from django.utils import timezone


# ── Department ────────────────────────────────────────────────────────────────

class StaffDepartmentSerializer(serializers.ModelSerializer):
    staff_count = serializers.SerializerMethodField()

    class Meta:
        model = StaffDepartment
        fields = [
            'id', 'school', 'name', 'description', 'is_active',
            'staff_count', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'staff_count', 'created_at', 'updated_at']

    def get_staff_count(self, obj):
        return obj.staff_members.filter(is_active=True).count()


class StaffDepartmentCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaffDepartment
        fields = ['name', 'description', 'is_active']

    def validate_name(self, value):
        school_id = self.context.get('school_id')
        if school_id:
            qs = StaffDepartment.objects.filter(school_id=school_id, name=value)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError('A department with this name already exists.')
        return value


# ── Designation ───────────────────────────────────────────────────────────────

class StaffDesignationSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source='department.name', read_only=True, default=None)

    class Meta:
        model = StaffDesignation
        fields = [
            'id', 'school', 'name', 'department', 'department_name',
            'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'school', 'department_name', 'created_at', 'updated_at']


class StaffDesignationCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaffDesignation
        fields = ['name', 'department', 'is_active']

    def validate_name(self, value):
        school_id = self.context.get('school_id')
        if school_id:
            qs = StaffDesignation.objects.filter(school_id=school_id, name=value)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError('A designation with this name already exists.')
        return value


# ── Staff Member ──────────────────────────────────────────────────────────────

class StaffMemberSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    department_name = serializers.CharField(source='department.name', read_only=True, default=None)
    designation_name = serializers.CharField(source='designation.name', read_only=True, default=None)
    user_username = serializers.CharField(source='user.username', read_only=True, default=None)

    class Meta:
        model = StaffMember
        fields = [
            'id', 'school', 'user', 'user_username',
            'first_name', 'last_name', 'full_name',
            'email', 'phone', 'gender', 'date_of_birth', 'photo_url',
            'employee_id', 'department', 'department_name',
            'designation', 'designation_name',
            'employment_type', 'employment_status',
            'date_of_joining', 'date_of_leaving',
            'address', 'emergency_contact_name', 'emergency_contact_phone',
            'notes', 'is_active',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'school', 'full_name', 'department_name',
            'designation_name', 'user_username',
            'created_at', 'updated_at',
        ]


class StaffMemberCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaffMember
        fields = [
            'user', 'first_name', 'last_name', 'email', 'phone',
            'gender', 'date_of_birth', 'photo_url',
            'employee_id', 'department', 'designation',
            'employment_type', 'employment_status',
            'date_of_joining', 'date_of_leaving',
            'address', 'emergency_contact_name', 'emergency_contact_phone',
            'notes',
        ]

    def validate_employee_id(self, value):
        if not value:
            return value
        school_id = self.context.get('school_id')
        qs = StaffMember.objects.filter(school_id=school_id, employee_id=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('Employee ID already exists in this school.')
        return value


class StaffMemberUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaffMember
        fields = [
            'first_name', 'last_name', 'email', 'phone',
            'gender', 'date_of_birth', 'photo_url',
            'employee_id', 'department', 'designation',
            'employment_type', 'employment_status',
            'date_of_joining', 'date_of_leaving',
            'address', 'emergency_contact_name', 'emergency_contact_phone',
            'notes', 'is_active',
        ]


# ── Salary Structure ─────────────────────────────────────────────────────────

class SalaryStructureSerializer(serializers.ModelSerializer):
    staff_member_name = serializers.CharField(source='staff_member.full_name', read_only=True)
    staff_employee_id = serializers.CharField(source='staff_member.employee_id', read_only=True, default=None)
    department_name = serializers.CharField(source='staff_member.department.name', read_only=True, default=None)
    gross_salary = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    total_deductions = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    net_salary = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = SalaryStructure
        fields = [
            'id', 'school', 'staff_member', 'staff_member_name',
            'staff_employee_id', 'department_name',
            'basic_salary', 'allowances', 'deductions',
            'gross_salary', 'total_deductions', 'net_salary',
            'effective_from', 'effective_to', 'is_active',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'school', 'staff_member_name', 'staff_employee_id',
            'department_name', 'gross_salary', 'total_deductions', 'net_salary',
            'created_at', 'updated_at',
        ]


class SalaryStructureCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = SalaryStructure
        fields = [
            'staff_member', 'basic_salary', 'allowances', 'deductions',
            'effective_from', 'effective_to', 'is_active',
        ]

    def validate(self, data):
        school_id = self.context.get('school_id')
        staff = data.get('staff_member')
        effective_from = data.get('effective_from')
        if school_id and staff and effective_from:
            qs = SalaryStructure.objects.filter(
                school_id=school_id,
                staff_member=staff,
                effective_from=effective_from,
            )
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    'A salary structure already exists for this staff member with the same effective date.'
                )
        return data


# ── Payslip ───────────────────────────────────────────────────────────────────

class PayslipSerializer(serializers.ModelSerializer):
    staff_member_name = serializers.CharField(source='staff_member.full_name', read_only=True)
    staff_employee_id = serializers.CharField(source='staff_member.employee_id', read_only=True, default=None)
    department_name = serializers.CharField(source='staff_member.department.name', read_only=True, default=None)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    generated_by_name = serializers.CharField(source='generated_by.username', read_only=True, default=None)

    class Meta:
        model = Payslip
        fields = [
            'id', 'school', 'staff_member', 'staff_member_name',
            'staff_employee_id', 'department_name',
            'month', 'year',
            'basic_salary', 'total_allowances', 'total_deductions', 'net_salary',
            'allowances_breakdown', 'deductions_breakdown',
            'working_days', 'present_days',
            'status', 'status_display',
            'payment_date', 'notes',
            'generated_by', 'generated_by_name',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'school', 'staff_member_name', 'staff_employee_id',
            'department_name', 'status_display', 'generated_by_name',
            'created_at', 'updated_at',
        ]


class PayslipCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payslip
        fields = [
            'staff_member', 'month', 'year',
            'basic_salary', 'total_allowances', 'total_deductions', 'net_salary',
            'allowances_breakdown', 'deductions_breakdown',
            'working_days', 'present_days',
            'status', 'payment_date', 'notes',
        ]

    def validate(self, data):
        month = data.get('month')
        if month is not None and (month < 1 or month > 12):
            raise serializers.ValidationError({'month': 'Month must be between 1 and 12.'})
        year = data.get('year')
        if year is not None and (year < 2000 or year > 2100):
            raise serializers.ValidationError({'year': 'Year must be between 2000 and 2100.'})
        # Check unique_together (school, staff_member, month, year)
        school_id = self.context.get('school_id')
        staff = data.get('staff_member')
        if school_id and staff and month and year:
            qs = Payslip.objects.filter(
                school_id=school_id, staff_member=staff, month=month, year=year,
            )
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    'A payslip already exists for this staff member for this month/year.'
                )
        return data


# ── Leave Policy ──────────────────────────────────────────────────────────────

class LeavePolicySerializer(serializers.ModelSerializer):
    leave_type_display = serializers.CharField(source='get_leave_type_display', read_only=True)
    applications_count = serializers.SerializerMethodField()

    class Meta:
        model = LeavePolicy
        fields = [
            'id', 'school', 'name', 'leave_type', 'leave_type_display',
            'days_allowed', 'carry_forward', 'is_active',
            'applications_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'school', 'leave_type_display', 'applications_count',
            'created_at', 'updated_at',
        ]

    def get_applications_count(self, obj):
        return obj.applications.count()


class LeavePolicyCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeavePolicy
        fields = ['name', 'leave_type', 'days_allowed', 'carry_forward', 'is_active']

    def validate_name(self, value):
        school_id = self.context.get('school_id')
        if school_id:
            qs = LeavePolicy.objects.filter(school_id=school_id, name=value)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError('A leave policy with this name already exists.')
        return value


# ── Leave Application ─────────────────────────────────────────────────────────

class LeaveApplicationSerializer(serializers.ModelSerializer):
    staff_member_name = serializers.CharField(source='staff_member.full_name', read_only=True)
    staff_employee_id = serializers.CharField(source='staff_member.employee_id', read_only=True, default=None)
    leave_policy_name = serializers.CharField(source='leave_policy.name', read_only=True, default=None)
    leave_type = serializers.CharField(source='leave_policy.leave_type', read_only=True, default=None)
    leave_type_display = serializers.CharField(source='leave_policy.get_leave_type_display', read_only=True, default=None)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    approved_by_name = serializers.CharField(source='approved_by.username', read_only=True, default=None)
    total_days = serializers.IntegerField(read_only=True)

    class Meta:
        model = LeaveApplication
        fields = [
            'id', 'school', 'staff_member', 'staff_member_name', 'staff_employee_id',
            'leave_policy', 'leave_policy_name', 'leave_type', 'leave_type_display',
            'start_date', 'end_date', 'total_days',
            'reason', 'status', 'status_display',
            'approved_by', 'approved_by_name', 'admin_remarks',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'school', 'staff_member_name', 'staff_employee_id',
            'leave_policy_name', 'leave_type', 'leave_type_display',
            'status_display', 'approved_by_name', 'total_days',
            'created_at', 'updated_at',
        ]


class LeaveApplicationCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaveApplication
        fields = [
            'staff_member', 'leave_policy', 'start_date', 'end_date', 'reason',
        ]

    def validate(self, data):
        start = data.get('start_date')
        end = data.get('end_date')
        if start and end and start > end:
            raise serializers.ValidationError(
                {'end_date': 'End date must be on or after start date.'}
            )
        return data


# ── Staff Attendance ──────────────────────────────────────────────────────────

class StaffAttendanceSerializer(serializers.ModelSerializer):
    staff_member_name = serializers.CharField(source='staff_member.full_name', read_only=True)
    staff_employee_id = serializers.CharField(source='staff_member.employee_id', read_only=True, default=None)
    department_name = serializers.CharField(source='staff_member.department.name', read_only=True, default=None)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    marked_by_name = serializers.CharField(source='marked_by.username', read_only=True, default=None)

    class Meta:
        model = StaffAttendance
        fields = [
            'id', 'school', 'staff_member', 'staff_member_name',
            'staff_employee_id', 'department_name',
            'date', 'status', 'status_display',
            'check_in', 'check_out', 'notes',
            'marked_by', 'marked_by_name',
            'created_at',
        ]
        read_only_fields = [
            'id', 'school', 'staff_member_name', 'staff_employee_id',
            'department_name', 'status_display', 'marked_by_name',
            'created_at',
        ]


class StaffAttendanceCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaffAttendance
        fields = ['staff_member', 'date', 'status', 'check_in', 'check_out', 'notes']

    def validate(self, data):
        school_id = self.context.get('school_id')
        staff = data.get('staff_member')
        att_date = data.get('date')
        if school_id and staff and att_date and not self.instance:
            if StaffAttendance.objects.filter(
                school_id=school_id, staff_member=staff, date=att_date,
            ).exists():
                raise serializers.ValidationError(
                    'Attendance already marked for this staff member on this date.'
                )
        return data


# ── Performance Appraisal ─────────────────────────────────────────────────────

class PerformanceAppraisalSerializer(serializers.ModelSerializer):
    staff_member_name = serializers.CharField(source='staff_member.full_name', read_only=True)
    staff_employee_id = serializers.CharField(source='staff_member.employee_id', read_only=True, default=None)
    department_name = serializers.CharField(source='staff_member.department.name', read_only=True, default=None)
    reviewer_name = serializers.CharField(source='reviewer.username', read_only=True, default=None)

    class Meta:
        model = PerformanceAppraisal
        fields = [
            'id', 'school', 'staff_member', 'staff_member_name',
            'staff_employee_id', 'department_name',
            'review_period_start', 'review_period_end',
            'rating', 'strengths', 'areas_for_improvement', 'goals', 'comments',
            'reviewer', 'reviewer_name',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'school', 'staff_member_name', 'staff_employee_id',
            'department_name', 'reviewer_name',
            'created_at', 'updated_at',
        ]


class PerformanceAppraisalCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = PerformanceAppraisal
        fields = [
            'staff_member', 'review_period_start', 'review_period_end',
            'rating', 'strengths', 'areas_for_improvement', 'goals', 'comments',
        ]

    def validate(self, data):
        start = data.get('review_period_start')
        end = data.get('review_period_end')
        if start and end and start > end:
            raise serializers.ValidationError(
                {'review_period_end': 'End date must be on or after start date.'}
            )
        rating = data.get('rating')
        if rating is not None and (rating < 1 or rating > 5):
            raise serializers.ValidationError(
                {'rating': 'Rating must be between 1 and 5.'}
            )
        return data


# ── Staff Qualification ───────────────────────────────────────────────────────

class StaffQualificationSerializer(serializers.ModelSerializer):
    staff_member_name = serializers.CharField(source='staff_member.full_name', read_only=True)
    staff_employee_id = serializers.CharField(source='staff_member.employee_id', read_only=True, default=None)
    qualification_type_display = serializers.CharField(source='get_qualification_type_display', read_only=True)

    class Meta:
        model = StaffQualification
        fields = [
            'id', 'school', 'staff_member', 'staff_member_name', 'staff_employee_id',
            'qualification_type', 'qualification_type_display',
            'qualification_name', 'institution',
            'year_of_completion', 'grade_or_percentage',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'school', 'staff_member_name', 'staff_employee_id',
            'qualification_type_display',
            'created_at', 'updated_at',
        ]


class StaffQualificationCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaffQualification
        fields = [
            'staff_member', 'qualification_type', 'qualification_name',
            'institution', 'year_of_completion', 'grade_or_percentage',
        ]


# ── Staff Document ────────────────────────────────────────────────────────────

class StaffDocumentSerializer(serializers.ModelSerializer):
    staff_member_name = serializers.CharField(source='staff_member.full_name', read_only=True)
    staff_employee_id = serializers.CharField(source='staff_member.employee_id', read_only=True, default=None)
    document_type_display = serializers.CharField(source='get_document_type_display', read_only=True)

    class Meta:
        model = StaffDocument
        fields = [
            'id', 'school', 'staff_member', 'staff_member_name', 'staff_employee_id',
            'document_type', 'document_type_display',
            'title', 'file_url', 'notes',
            'uploaded_at',
        ]
        read_only_fields = [
            'id', 'school', 'staff_member_name', 'staff_employee_id',
            'document_type_display',
            'uploaded_at',
        ]


class StaffDocumentCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaffDocument
        fields = ['staff_member', 'document_type', 'title', 'file_url', 'notes']
