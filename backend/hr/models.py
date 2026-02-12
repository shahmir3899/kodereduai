from django.db import models
from django.core.validators import MinValueValidator, MaxValueValidator


class StaffDepartment(models.Model):
    """Departments: Academic, Admin, Support, Finance, etc."""
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='staff_departments',
    )
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'name')
        ordering = ['name']
        verbose_name = 'Staff Department'
        verbose_name_plural = 'Staff Departments'

    def __str__(self):
        return self.name


class StaffDesignation(models.Model):
    """Job titles: Principal, Senior Teacher, Accountant, etc."""
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='staff_designations',
    )
    name = models.CharField(max_length=100)
    department = models.ForeignKey(
        StaffDepartment,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='designations',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'name')
        ordering = ['name']
        verbose_name = 'Staff Designation'
        verbose_name_plural = 'Staff Designations'

    def __str__(self):
        return self.name


class StaffMember(models.Model):
    """
    Central employee/staff profile — tracks employment details.
    Linked to User model via OneToOne for login access.
    """
    class EmploymentStatus(models.TextChoices):
        ACTIVE = 'ACTIVE', 'Active'
        ON_LEAVE = 'ON_LEAVE', 'On Leave'
        TERMINATED = 'TERMINATED', 'Terminated'
        RESIGNED = 'RESIGNED', 'Resigned'

    class EmploymentType(models.TextChoices):
        FULL_TIME = 'FULL_TIME', 'Full Time'
        PART_TIME = 'PART_TIME', 'Part Time'
        CONTRACT = 'CONTRACT', 'Contract'
        TEMPORARY = 'TEMPORARY', 'Temporary'

    class Gender(models.TextChoices):
        MALE = 'MALE', 'Male'
        FEMALE = 'FEMALE', 'Female'
        OTHER = 'OTHER', 'Other'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='staff_members',
    )
    user = models.OneToOneField(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='staff_profile',
        help_text='Linked user account (null if staff has no login)',
    )

    # Basic Info
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=20, blank=True)
    gender = models.CharField(
        max_length=10,
        choices=Gender.choices,
        blank=True,
    )
    date_of_birth = models.DateField(null=True, blank=True)
    photo_url = models.URLField(blank=True, null=True)

    # Employment Details
    employee_id = models.CharField(
        max_length=50,
        blank=True,
        help_text='School-assigned employee ID',
    )
    department = models.ForeignKey(
        StaffDepartment,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='staff_members',
    )
    designation = models.ForeignKey(
        StaffDesignation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='staff_members',
    )
    employment_type = models.CharField(
        max_length=20,
        choices=EmploymentType.choices,
        default=EmploymentType.FULL_TIME,
    )
    employment_status = models.CharField(
        max_length=20,
        choices=EmploymentStatus.choices,
        default=EmploymentStatus.ACTIVE,
    )
    date_of_joining = models.DateField(null=True, blank=True)
    date_of_leaving = models.DateField(null=True, blank=True)

    # Address & Emergency Contact
    address = models.TextField(blank=True)
    emergency_contact_name = models.CharField(max_length=100, blank=True)
    emergency_contact_phone = models.CharField(max_length=20, blank=True)

    # Notes
    notes = models.TextField(blank=True)

    # Status
    is_active = models.BooleanField(default=True)

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['first_name', 'last_name']
        verbose_name = 'Staff Member'
        verbose_name_plural = 'Staff Members'
        indexes = [
            models.Index(fields=['school', 'is_active']),
            models.Index(fields=['school', 'employment_status']),
            models.Index(fields=['school', 'department']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['school', 'employee_id'],
                condition=models.Q(employee_id__gt=''),
                name='unique_employee_id_per_school',
            ),
        ]

    def __str__(self):
        return f"{self.first_name} {self.last_name}"

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}"


class StaffQualification(models.Model):
    """Educational & professional qualifications."""
    class QualificationType(models.TextChoices):
        DEGREE = 'DEGREE', 'Degree'
        DIPLOMA = 'DIPLOMA', 'Diploma'
        CERTIFICATION = 'CERTIFICATION', 'Certification'
        TRAINING = 'TRAINING', 'Training'
        LICENSE = 'LICENSE', 'License'

    staff_member = models.ForeignKey(
        StaffMember,
        on_delete=models.CASCADE,
        related_name='qualifications',
    )
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='staff_qualifications',
    )
    qualification_type = models.CharField(
        max_length=20,
        choices=QualificationType.choices,
        default=QualificationType.DEGREE,
    )
    qualification_name = models.CharField(max_length=200)
    institution = models.CharField(max_length=200, blank=True)
    year_of_completion = models.IntegerField(null=True, blank=True)
    grade_or_percentage = models.CharField(max_length=50, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-year_of_completion']
        verbose_name = 'Staff Qualification'
        verbose_name_plural = 'Staff Qualifications'

    def __str__(self):
        return f"{self.staff_member.full_name} — {self.qualification_name}"


class StaffDocument(models.Model):
    """Store documents: contract, certifications, ID, etc."""
    class DocumentType(models.TextChoices):
        ID_DOCUMENT = 'ID_DOCUMENT', 'ID Document'
        CONTRACT = 'CONTRACT', 'Contract'
        CERTIFICATE = 'CERTIFICATE', 'Certificate'
        MEDICAL = 'MEDICAL', 'Medical Certificate'
        OTHER = 'OTHER', 'Other'

    staff_member = models.ForeignKey(
        StaffMember,
        on_delete=models.CASCADE,
        related_name='documents',
    )
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='staff_documents',
    )
    document_type = models.CharField(
        max_length=20,
        choices=DocumentType.choices,
        default=DocumentType.OTHER,
    )
    title = models.CharField(max_length=200)
    file_url = models.URLField(help_text='Supabase storage URL')
    uploaded_at = models.DateTimeField(auto_now_add=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ['-uploaded_at']
        verbose_name = 'Staff Document'
        verbose_name_plural = 'Staff Documents'

    def __str__(self):
        return f"{self.staff_member.full_name} — {self.title}"


class SalaryStructure(models.Model):
    """Monthly salary breakdown per staff member."""
    staff_member = models.ForeignKey(
        StaffMember,
        on_delete=models.CASCADE,
        related_name='salary_structures',
    )
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='salary_structures',
    )
    basic_salary = models.DecimalField(max_digits=12, decimal_places=2)
    allowances = models.JSONField(
        default=dict,
        help_text='e.g. {"house_rent": 10000, "transport": 2000}',
    )
    deductions = models.JSONField(
        default=dict,
        help_text='e.g. {"provident_fund": 2000, "tax": 3500}',
    )
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-effective_from']
        verbose_name = 'Salary Structure'
        verbose_name_plural = 'Salary Structures'
        indexes = [
            models.Index(fields=['school', 'staff_member']),
        ]

    def __str__(self):
        return f"{self.staff_member.full_name} — {self.basic_salary}/month"

    @property
    def gross_salary(self):
        return self.basic_salary + sum(self.allowances.values())

    @property
    def total_deductions(self):
        return sum(self.deductions.values())

    @property
    def net_salary(self):
        return self.gross_salary - self.total_deductions


class Payslip(models.Model):
    """Generated payslip for each staff member per month."""
    class Status(models.TextChoices):
        DRAFT = 'DRAFT', 'Draft'
        APPROVED = 'APPROVED', 'Approved'
        PAID = 'PAID', 'Paid'

    staff_member = models.ForeignKey(
        StaffMember,
        on_delete=models.CASCADE,
        related_name='payslips',
    )
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='payslips',
    )
    month = models.IntegerField(help_text='Month number (1-12)')
    year = models.IntegerField(help_text='Year (e.g. 2026)')
    basic_salary = models.DecimalField(max_digits=12, decimal_places=2)
    total_allowances = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_deductions = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    net_salary = models.DecimalField(max_digits=12, decimal_places=2)
    allowances_breakdown = models.JSONField(default=dict)
    deductions_breakdown = models.JSONField(default=dict)
    working_days = models.IntegerField(default=0)
    present_days = models.IntegerField(default=0)
    status = models.CharField(
        max_length=10,
        choices=Status.choices,
        default=Status.DRAFT,
    )
    payment_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    generated_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        related_name='generated_payslips',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('school', 'staff_member', 'month', 'year')
        ordering = ['-year', '-month']
        verbose_name = 'Payslip'
        verbose_name_plural = 'Payslips'
        indexes = [
            models.Index(fields=['school', 'year', 'month']),
        ]

    def __str__(self):
        return f"{self.staff_member.full_name} — {self.month}/{self.year}"


class LeavePolicy(models.Model):
    """School's leave policy configuration — one record per leave type."""
    class LeaveType(models.TextChoices):
        ANNUAL = 'ANNUAL', 'Annual Leave'
        SICK = 'SICK', 'Sick Leave'
        CASUAL = 'CASUAL', 'Casual Leave'
        MATERNITY = 'MATERNITY', 'Maternity Leave'
        UNPAID = 'UNPAID', 'Unpaid Leave'
        OTHER = 'OTHER', 'Other'

    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='leave_policies',
    )
    name = models.CharField(max_length=100)
    leave_type = models.CharField(
        max_length=20,
        choices=LeaveType.choices,
    )
    days_allowed = models.IntegerField(help_text='Total allowed days per year')
    carry_forward = models.BooleanField(
        default=False,
        help_text='Allow unused days to carry forward',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Leave Policy'
        verbose_name_plural = 'Leave Policies'

    def __str__(self):
        return f"{self.name} ({self.days_allowed} days)"


class LeaveApplication(models.Model):
    """Individual leave application by staff."""
    class Status(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        APPROVED = 'APPROVED', 'Approved'
        REJECTED = 'REJECTED', 'Rejected'
        CANCELLED = 'CANCELLED', 'Cancelled'

    staff_member = models.ForeignKey(
        StaffMember,
        on_delete=models.CASCADE,
        related_name='leave_applications',
    )
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='leave_applications',
    )
    leave_policy = models.ForeignKey(
        LeavePolicy,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='applications',
    )
    start_date = models.DateField()
    end_date = models.DateField()
    reason = models.TextField()
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
    )
    approved_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='approved_leaves',
    )
    admin_remarks = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Leave Application'
        verbose_name_plural = 'Leave Applications'
        indexes = [
            models.Index(fields=['school', 'status']),
            models.Index(fields=['staff_member', 'start_date', 'end_date']),
        ]

    def __str__(self):
        return f"{self.staff_member.full_name} — {self.start_date} to {self.end_date}"

    @property
    def total_days(self):
        if self.start_date and self.end_date:
            return (self.end_date - self.start_date).days + 1
        return 0


class StaffAttendance(models.Model):
    """
    Daily attendance tracking for staff.
    Separate from student attendance (backend/attendance/models.py).
    """
    class Status(models.TextChoices):
        PRESENT = 'PRESENT', 'Present'
        ABSENT = 'ABSENT', 'Absent'
        LATE = 'LATE', 'Late'
        HALF_DAY = 'HALF_DAY', 'Half Day'
        ON_LEAVE = 'ON_LEAVE', 'On Leave'

    staff_member = models.ForeignKey(
        StaffMember,
        on_delete=models.CASCADE,
        related_name='attendance_records',
    )
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='staff_attendance_records',
    )
    date = models.DateField()
    status = models.CharField(max_length=20, choices=Status.choices)
    check_in = models.TimeField(null=True, blank=True)
    check_out = models.TimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    marked_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='marked_staff_attendance',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('school', 'staff_member', 'date')
        ordering = ['-date']
        verbose_name = 'Staff Attendance'
        verbose_name_plural = 'Staff Attendance Records'
        indexes = [
            models.Index(fields=['school', 'date']),
        ]

    def __str__(self):
        return f"{self.staff_member.full_name} — {self.date}: {self.get_status_display()}"


class PerformanceAppraisal(models.Model):
    """Annual/periodic performance review."""
    staff_member = models.ForeignKey(
        StaffMember,
        on_delete=models.CASCADE,
        related_name='appraisals',
    )
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='appraisals',
    )
    review_period_start = models.DateField()
    review_period_end = models.DateField()
    rating = models.IntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)],
        help_text='Overall rating 1-5',
    )
    strengths = models.TextField(blank=True)
    areas_for_improvement = models.TextField(blank=True)
    goals = models.TextField(blank=True)
    comments = models.TextField(blank=True)
    reviewer = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='conducted_appraisals',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-review_period_end']
        verbose_name = 'Performance Appraisal'
        verbose_name_plural = 'Performance Appraisals'

    def __str__(self):
        return f"{self.staff_member.full_name} — Rating: {self.rating}/5"
