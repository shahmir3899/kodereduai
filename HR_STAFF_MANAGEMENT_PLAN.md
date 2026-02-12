# HR & Staff Management Implementation Plan
## Smart Attendance Platform (KoderEduAI)

> **Date:** February 12, 2026
> **Status:** Planning Phase (No Implementation)
> **Scope:** Detailed design for HR/Staff module — models, APIs, UI, and integration with existing Attendance, Finance, and School modules

---

## Executive Summary

HR & Payroll is a **critical missing module** ranked #4 in the market gap analysis. This module will enable:
- Complete staff records management (teachers, admin, support staff)
- Department/subject assignment
- Salary structure & payroll calculation
- Leave management (annual, medical, casual, etc.)
- Performance tracking & appraisals
- Attendance tracking for staff (separate from student attendance)
- Automated payslip generation

**Revenue Impact:** Schools won't adopt your platform without this. It's table-stakes for school ERPs.

---

## Part 1: CURRENT ROLES IN SYSTEM

### 1.1 Existing Role Matrix

| Role              | Scope          | Current Permissions                                    | Limitations                              |
|-------------------|----------------|--------------------------------------------------------|------------------------------------------|
| **SUPER_ADMIN**   | Platform-wide  | All schools, all modules, user management, billing     | No per-module granularity                 |
| **SCHOOL_ADMIN**  | Single school  | Full CRUD on own school's data                         | Merged too many responsibilities          |
| **PRINCIPAL**     | Single school  | Academic + admin oversight (implied, not enforced)     | Role exists but no distinct permissions  |
| **STAFF**         | Single school  | Read-only access, limited finance visibility           | Too generic (includes teachers + support) |

### 1.2 Current Role Definition (Actual Code)

**Location:** [`backend/users/models.py:40-44`](backend/users/models.py#L40-L44)

```python
class Role(models.TextChoices):
    SUPER_ADMIN = 'SUPER_ADMIN', 'Super Admin'     # Platform owner
    SCHOOL_ADMIN = 'SCHOOL_ADMIN', 'School Admin'  # School owner/manager
    PRINCIPAL = 'PRINCIPAL', 'Principal'            # School head
    STAFF = 'STAFF', 'Staff'                        # Generic staff/teacher
```

**Location:** [`backend/schools/models.py:30-33`](backend/schools/models.py#L30-L33) — `UserSchoolMembership.Role`

```python
class Role(models.TextChoices):
    SCHOOL_ADMIN = 'SCHOOL_ADMIN', 'School Admin'
    PRINCIPAL = 'PRINCIPAL', 'Principal'
    STAFF = 'STAFF', 'Staff'
```

**Permission system:** [`backend/core/permissions.py`](backend/core/permissions.py)
- `ADMIN_ROLES = ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL')` — used across all permission classes
- `get_effective_role(request)` resolves the user's role for the active school via `UserSchoolMembership`
- Permission classes: `IsSuperAdmin`, `IsSchoolAdmin`, `IsSchoolAdminOrReadOnly`, `HasSchoolAccess`, `IsSchoolAdminOrStaffReadOnly`, `CanManageAttendance`, `CanConfirmAttendance`

### 1.3 Problems with Current Role Model

1. **STAFF is too broad** — Cannot differentiate teachers, accountants, librarians, drivers, etc.
2. **No department/subject mapping** — Teachers have no subject assignment
3. **No hierarchical structure** — All roles are flat, no manager/subordinate relationships
4. **No skills/certifications tracking** — Can't track teacher qualifications
5. **No leave/absence distinction** — Staff attendance vs. student attendance is the same concept
6. **No salary/compensation tracking** — Critical for payroll
7. **No permissions fine-tuning** — Can't give Accountant access to finance only
8. **Finance `Expense.Category.SALARY`** exists at [`backend/finance/models.py:358`](backend/finance/models.py#L358) but has no link to staff records — salary expenses are just flat numbers with no per-staff breakdown

---

## Part 2: NEW ROLES NEEDED FOR HR/STAFF MODULE

### 2.1 Recommended Role Hierarchy

```
SUPER_ADMIN (Platform Level — User.role)
│
├── SCHOOL_ADMIN (School Level — UserSchoolMembership.role)
│   ├── PRINCIPAL
│   ├── VICE_PRINCIPAL
│   ├── ACCOUNTANT
│   ├── HR_MANAGER
│   ├── TEACHER (Distinct from generic STAFF)
│   ├── SUPPORT_STAFF
│   │   ├── Librarian
│   │   ├── Transport Manager
│   │   ├── Front Office
│   │   └── Maintenance
│   ├── PARENT
│   └── STUDENT
```

### 2.2 Detailed New Roles Description

| Role | Permission Scope | Primary Responsibilities | Module Access | Reports Access |
|------|------------------|--------------------------|----------------|-----------------|
| **PRINCIPAL** | School Administrative | Academic oversight, approvals, teacher evaluations, school policy | Attendance, Classes, Students, Finance (summary), Staff (read) | School summary reports, performance analytics |
| **ACCOUNTANT** | Finance Department | Fee management, expense tracking, financial reporting, audit trails | Finance only (full), Accounts, Transfers, Fee Collection, Reports | All financial reports + export |
| **HR_MANAGER** | HR Department | Staff records, salary structure, leave management, payroll, compliance | HR only (full), Staff Records, Salary, Leave, Attendance, Appraisals | Salary reports, leave analytics, staff records export |
| **TEACHER** | Assigned Classes/Subjects | Mark attendance for own classes, submit grades, manage own profile, view student info | Attendance (own classes), Classes (read), Students (filtered), Grades | Class-wise attendance, student performance |
| **LIBRARIAN** | Library Module | Manage inventory, issue/return, reservations, fines | Library only (full) | Library reports |
| **TRANSPORT_MANAGER** | Transport Module | Route planning, vehicle management, driver assignment | Transport only (full) | Transport reports |
| **FRONT_OFFICE** | Reception/Admission | Visitor log, inquiries, admission forms processing | Admission, Students (limited), Communication | Inquiry reports, admission pipeline |
| **SUPPORT_STAFF** | Generic Support | Common operational tasks (read-only on most things) | All modules (read-only) | Limited reports |

### 2.3 Role Permission Matrix for HR Module

| Feature | SCHOOL_ADMIN | PRINCIPAL | ACCOUNTANT | HR_MANAGER | TEACHER | Support Staff |
|---------|:---:|:---:|:---:|:---:|:---:|:---:|
| **Staff Records** ||||
| Create staff | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Edit staff | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Delete staff | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| View staff | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Upload documents | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| **Salary & Payroll** ||||
| Create salary structure | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Edit salary | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Generate payslip | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| View payslip | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ |
| **Leave Management** ||||
| Define leave policy | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Approve leave | ✅ | ✅ | ❌ | ✅ | ⚠️* | ❌ |
| View leave balance | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| Apply for leave | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Attendance (Staff)** ||||
| Mark attendance | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| View attendance | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| **Performance** ||||
| Create appraisal | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| View appraisal | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| **Compliance** ||||
| Tax reports | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Audit logs | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |

_*⚠️ = Can only approve for their own team members_

### 2.4 Implementation: Changes to Existing Role Enums

**Step 1 — Expand `UserSchoolMembership.Role`** in [`backend/schools/models.py:30-33`](backend/schools/models.py#L30-L33):

```python
class Role(models.TextChoices):
    SCHOOL_ADMIN = 'SCHOOL_ADMIN', 'School Admin'
    PRINCIPAL = 'PRINCIPAL', 'Principal'
    VICE_PRINCIPAL = 'VICE_PRINCIPAL', 'Vice Principal'   # NEW
    HR_MANAGER = 'HR_MANAGER', 'HR Manager'               # NEW
    ACCOUNTANT = 'ACCOUNTANT', 'Accountant'               # NEW
    TEACHER = 'TEACHER', 'Teacher'                         # NEW (distinct from STAFF)
    STAFF = 'STAFF', 'Staff'                               # Keep for backward compat
    SUPPORT_STAFF = 'SUPPORT_STAFF', 'Support Staff'       # NEW
```

**Step 2 — Expand `ADMIN_ROLES`** in [`backend/core/permissions.py:9`](backend/core/permissions.py#L9):

```python
ADMIN_ROLES = ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL', 'VICE_PRINCIPAL')
HR_ROLES = ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'HR_MANAGER')
FINANCE_ROLES = ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'ACCOUNTANT')
```

**Step 3 — Update `AuthContext.jsx`** in [`frontend/src/contexts/AuthContext.jsx`](frontend/src/contexts/AuthContext.jsx) to expose new role checks:

```javascript
const isHRManager = membership?.role === 'HR_MANAGER'
const isAccountant = membership?.role === 'ACCOUNTANT'
const isTeacher = membership?.role === 'TEACHER'
```

### 2.5 Phased Role Rollout

| Phase | Roles To Add | Priority | Status |
|-------|--------------|----------|--------|
| Phase 0 (Now) | Current 4 roles — keep as-is | Critical | Done |
| Phase 1 | TEACHER, ACCOUNTANT, HR_MANAGER | High | Plan this |
| Phase 2 | LIBRARIAN, TRANSPORT_MANAGER, FRONT_OFFICE | Medium | Q2 2026 |
| Phase 3 | PARENT, STUDENT (with portals) | High | Q3 2026 |
| Phase 4 | Support staff subtypes | Low | Q4 2026 |

---

## Part 3: DATABASE MODELS FOR HR MODULE

> All models follow existing project conventions:
> - `school = ForeignKey('schools.School')` for tenant isolation (see [`backend/finance/models.py`](backend/finance/models.py))
> - `created_at = DateTimeField(auto_now_add=True)` / `updated_at = DateTimeField(auto_now=True)`
> - `Meta.indexes` for query performance
> - `related_name` on all ForeignKeys
> - `JSONField` for flexible data (see `School.mark_mappings`, `School.enabled_modules`)

### 3.1 New Django App: `backend/hr/`

Create a new Django app at `backend/hr/` with the following structure:

```
backend/hr/
├── __init__.py
├── admin.py
├── apps.py
├── models.py          # All HR models
├── serializers.py     # DRF serializers
├── views.py           # DRF ViewSets
├── urls.py            # URL routing
├── permissions.py     # HR-specific permissions
├── services.py        # Business logic (payslip calc, leave balance)
├── tasks.py           # Celery tasks (batch payslip generation)
├── migrations/
│   └── __init__.py
└── tests/
    └── __init__.py
```

Register in [`backend/config/settings.py`](backend/config/settings.py) `INSTALLED_APPS`:
```python
INSTALLED_APPS = [
    ...
    'hr',  # NEW
]
```

Add URL route in [`backend/config/urls.py:70`](backend/config/urls.py#L70):
```python
# HR & Staff Management
path('api/hr/', include('hr.urls')),
```

### 3.2 Models — `backend/hr/models.py`

#### 3.2.1 StaffDepartment

```python
class StaffDepartment(models.Model):
    """Departments: Academic, Admin, Support, Finance, etc."""
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='staff_departments',
    )
    name = models.CharField(max_length=100)  # e.g., "Mathematics", "Administration"
    head = models.ForeignKey(
        'StaffMember',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='department_head_of',
    )
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('school', 'name')
        ordering = ['name']
        verbose_name = 'Staff Department'
        verbose_name_plural = 'Staff Departments'

    def __str__(self):
        return self.name
```

#### 3.2.2 StaffDesignation

```python
class StaffDesignation(models.Model):
    """Job titles: Principal, Senior Teacher, Accountant, etc."""
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='staff_designations',
    )
    title = models.CharField(max_length=100)
    base_salary = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Default base salary for this designation",
    )
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('school', 'title')
        ordering = ['title']
        verbose_name = 'Staff Designation'
        verbose_name_plural = 'Staff Designations'

    def __str__(self):
        return self.title
```

#### 3.2.3 StaffMember (Core)

```python
class StaffMember(models.Model):
    """
    Central employee/staff profile — tracks employment details.
    Linked to User model via OneToOne for login access.
    """
    class StaffType(models.TextChoices):
        PERMANENT = 'PERMANENT', 'Permanent'
        CONTRACT = 'CONTRACT', 'Contract'
        TEMPORARY = 'TEMPORARY', 'Temporary'
        SUBSTITUTE = 'SUBSTITUTE', 'Substitute'

    class Gender(models.TextChoices):
        MALE = 'M', 'Male'
        FEMALE = 'F', 'Female'
        OTHER = 'O', 'Other'

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
        help_text="Linked user account (null if staff has no login)",
    )

    # Basic Info
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=20, blank=True)
    gender = models.CharField(max_length=1, choices=Gender.choices, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    profile_photo_url = models.URLField(blank=True, null=True)

    # Employment Details
    staff_code = models.CharField(max_length=50, blank=True)
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
    staff_type = models.CharField(
        max_length=20,
        choices=StaffType.choices,
        default=StaffType.PERMANENT,
    )
    subjects = models.JSONField(
        default=list,
        blank=True,
        help_text="For teachers: ['Mathematics', 'Science']",
    )

    # Dates
    joining_date = models.DateField(null=True, blank=True)
    leaving_date = models.DateField(null=True, blank=True)

    # Identification
    nic_number = models.CharField(max_length=20, blank=True, help_text="National ID Card number")
    bank_account = models.CharField(max_length=50, blank=True)
    bank_name = models.CharField(max_length=100, blank=True)

    # Address
    home_address = models.TextField(blank=True)
    city = models.CharField(max_length=100, blank=True)

    # Emergency Contact
    emergency_contact_name = models.CharField(max_length=100, blank=True)
    emergency_contact_phone = models.CharField(max_length=20, blank=True)
    emergency_contact_relation = models.CharField(max_length=50, blank=True)

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
            models.Index(fields=['school', 'department']),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['school', 'staff_code'],
                condition=models.Q(staff_code__gt=''),
                name='unique_staff_code_per_school',
            ),
        ]

    def __str__(self):
        return f"{self.first_name} {self.last_name}"

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}"
```

#### 3.2.4 SalaryStructure

```python
class SalaryStructure(models.Model):
    """Monthly salary breakdown per staff member."""
    staff = models.OneToOneField(
        StaffMember,
        on_delete=models.CASCADE,
        related_name='salary_structure',
    )
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='salary_structures',
    )

    # Base Salary
    base_salary = models.DecimalField(max_digits=12, decimal_places=2)

    # Allowances (flexible JSON — school can define own components)
    allowances = models.JSONField(
        default=dict,
        help_text='e.g. {"house_rent": 10000, "transport": 2000, "medical": 1500}',
    )

    # Deductions (flexible JSON)
    deductions = models.JSONField(
        default=dict,
        help_text='e.g. {"provident_fund": 2000, "tax": 3500, "health_insurance": 1000}',
    )

    # Effective dates
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)

    # Tracking
    created_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_salary_structures',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Salary Structure'
        verbose_name_plural = 'Salary Structures'

    def __str__(self):
        return f"{self.staff.full_name} — {self.net_salary}/month"

    @property
    def gross_salary(self):
        return self.base_salary + sum(self.allowances.values())

    @property
    def total_deductions(self):
        return sum(self.deductions.values())

    @property
    def net_salary(self):
        return self.gross_salary - self.total_deductions
```

#### 3.2.5 Payslip

```python
class Payslip(models.Model):
    """Generated payslip for each staff member per month."""
    staff = models.ForeignKey(
        StaffMember,
        on_delete=models.CASCADE,
        related_name='payslips',
    )
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='payslips',
    )

    # Period
    month = models.IntegerField(help_text="Month number (1-12)")
    year = models.IntegerField(help_text="Year (e.g. 2026)")

    # Salary Details (snapshot at time of generation)
    base_salary = models.DecimalField(max_digits=12, decimal_places=2)
    allowances_breakdown = models.JSONField(default=dict)
    deductions_breakdown = models.JSONField(default=dict)
    allowances_total = models.DecimalField(max_digits=12, decimal_places=2)
    deductions_total = models.DecimalField(max_digits=12, decimal_places=2)

    # Attendance
    working_days = models.IntegerField(default=20)
    present_days = models.IntegerField(default=0)
    leave_days = models.IntegerField(default=0)

    # Calculated
    gross_salary = models.DecimalField(max_digits=12, decimal_places=2)
    net_salary = models.DecimalField(max_digits=12, decimal_places=2)

    # Status & Approval
    is_approved = models.BooleanField(default=False)
    is_paid = models.BooleanField(default=False)
    paid_date = models.DateField(null=True, blank=True)

    # Tracking
    generated_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        related_name='generated_payslips',
    )
    approved_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='approved_payslips',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('staff', 'month', 'year')
        ordering = ['-year', '-month']
        verbose_name = 'Payslip'
        verbose_name_plural = 'Payslips'
        indexes = [
            models.Index(fields=['school', 'year', 'month']),
        ]

    def __str__(self):
        return f"{self.staff.full_name} — {self.month}/{self.year}: {self.net_salary}"
```

#### 3.2.6 LeavePolicy

```python
class LeavePolicy(models.Model):
    """School's leave policy configuration per fiscal year."""
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='leave_policies',
    )
    name = models.CharField(max_length=100, help_text='e.g. "FY 2025-26"')
    financial_year_start = models.DateField()
    financial_year_end = models.DateField()

    # Leave types with max allowed days (flexible JSON)
    leave_types = models.JSONField(
        default=dict,
        help_text='e.g. {"annual": 30, "medical": 10, "casual": 5, "emergency": 2, "maternity": 45}',
    )

    # Policy rules
    carryforward_max = models.IntegerField(default=10, help_text="Max days to carry forward")
    require_approval = models.BooleanField(default=True)
    approval_days_advance = models.IntegerField(default=7, help_text="Days in advance to apply")
    require_medical_certificate = models.BooleanField(
        default=True,
        help_text="Require medical cert for sick leave > 2 days",
    )

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-financial_year_start']
        verbose_name = 'Leave Policy'
        verbose_name_plural = 'Leave Policies'

    def __str__(self):
        return f"{self.school.name} — {self.name}"
```

#### 3.2.7 LeaveApplication

```python
class LeaveApplication(models.Model):
    """Individual leave application by staff."""
    class Status(models.TextChoices):
        PENDING = 'PENDING', 'Pending Approval'
        APPROVED = 'APPROVED', 'Approved'
        REJECTED = 'REJECTED', 'Rejected'
        CANCELLED = 'CANCELLED', 'Cancelled'

    staff = models.ForeignKey(
        StaffMember,
        on_delete=models.CASCADE,
        related_name='leave_applications',
    )
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='leave_applications',
    )

    leave_type = models.CharField(max_length=50, help_text="annual, medical, casual, etc.")
    from_date = models.DateField()
    to_date = models.DateField()
    days_applied = models.IntegerField(help_text="Calculated total days")
    reason = models.TextField()

    # Attachments (stored in Supabase, same as attendance images)
    attachments = models.JSONField(
        default=list,
        help_text="List of Supabase URLs for medical certs, etc.",
    )

    # Approval
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    approval_comments = models.TextField(blank=True)
    approved_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='approved_leaves',
    )
    approved_date = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Leave Application'
        verbose_name_plural = 'Leave Applications'
        indexes = [
            models.Index(fields=['school', 'status']),
            models.Index(fields=['staff', 'from_date', 'to_date']),
        ]

    def __str__(self):
        return f"{self.staff.full_name} — {self.leave_type} ({self.from_date} to {self.to_date})"
```

#### 3.2.8 StaffAttendance

```python
class StaffAttendance(models.Model):
    """
    Daily attendance tracking for staff (separate from student attendance).
    Student attendance lives in backend/attendance/models.py (AttendanceRecord).
    """
    class Status(models.TextChoices):
        PRESENT = 'PRESENT', 'Present'
        ABSENT = 'ABSENT', 'Absent'
        ON_LEAVE = 'ON_LEAVE', 'On Leave'
        HALF_DAY = 'HALF_DAY', 'Half Day'
        WORK_FROM_HOME = 'WORK_FROM_HOME', 'Work from Home'

    staff = models.ForeignKey(
        StaffMember,
        on_delete=models.CASCADE,
        related_name='attendance_records',
    )
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='staff_attendance_records',
    )
    attendance_date = models.DateField()
    status = models.CharField(max_length=20, choices=Status.choices)

    check_in_time = models.TimeField(null=True, blank=True)
    check_out_time = models.TimeField(null=True, blank=True)
    marked_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        related_name='marked_staff_attendance',
    )
    notes = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('staff', 'attendance_date')
        ordering = ['-attendance_date']
        verbose_name = 'Staff Attendance'
        verbose_name_plural = 'Staff Attendance Records'
        indexes = [
            models.Index(fields=['school', 'attendance_date']),
        ]

    def __str__(self):
        return f"{self.staff.full_name} — {self.attendance_date}: {self.get_status_display()}"
```

#### 3.2.9 PerformanceAppraisal

```python
class PerformanceAppraisal(models.Model):
    """Annual/periodic performance review."""
    staff = models.ForeignKey(
        StaffMember,
        on_delete=models.CASCADE,
        related_name='appraisals',
    )
    school = models.ForeignKey(
        'schools.School',
        on_delete=models.CASCADE,
        related_name='appraisals',
    )

    appraisal_date = models.DateField()
    fiscal_year = models.CharField(max_length=10, help_text='e.g. "2025-26"')

    # Ratings (1-5 scale, stored as JSON for flexibility)
    ratings = models.JSONField(
        default=dict,
        help_text='e.g. {"subject_knowledge": 4, "communication": 5, "punctuality": 3, ...}',
    )

    # Open feedback
    strengths = models.TextField(blank=True)
    areas_improvement = models.TextField(blank=True)
    goals_upcoming = models.TextField(blank=True)
    overall_comments = models.TextField(blank=True)

    # Tracking
    reviewed_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        related_name='conducted_appraisals',
    )
    discussed_with_staff = models.BooleanField(default=False)
    discussed_date = models.DateField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-appraisal_date']
        verbose_name = 'Performance Appraisal'
        verbose_name_plural = 'Performance Appraisals'
        indexes = [
            models.Index(fields=['school', 'fiscal_year']),
        ]

    def __str__(self):
        return f"{self.staff.full_name} — {self.fiscal_year}"

    @property
    def overall_rating(self):
        if not self.ratings:
            return 0
        values = [v for v in self.ratings.values() if isinstance(v, (int, float))]
        return round(sum(values) / len(values), 2) if values else 0
```

#### 3.2.10 StaffQualification

```python
class StaffQualification(models.Model):
    """Educational & professional qualifications."""
    class QualificationType(models.TextChoices):
        DEGREE = 'DEGREE', 'Degree'
        DIPLOMA = 'DIPLOMA', 'Diploma'
        CERTIFICATION = 'CERTIFICATION', 'Certification'
        TRAINING = 'TRAINING', 'Training'
        LICENSE = 'LICENSE', 'License'

    staff = models.ForeignKey(
        StaffMember,
        on_delete=models.CASCADE,
        related_name='qualifications',
    )
    qualification_type = models.CharField(max_length=20, choices=QualificationType.choices)
    qualification_name = models.CharField(max_length=200, help_text='e.g. "Bachelor of Education"')
    institution = models.CharField(max_length=200)
    completion_date = models.DateField()
    document_url = models.URLField(null=True, blank=True, help_text="Supabase URL")
    is_verified = models.BooleanField(default=False)
    verified_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-completion_date']
        verbose_name = 'Staff Qualification'
        verbose_name_plural = 'Staff Qualifications'

    def __str__(self):
        return f"{self.staff.full_name} — {self.qualification_name}"
```

#### 3.2.11 StaffDocument

```python
class StaffDocument(models.Model):
    """Store documents: contract, certifications, ID, etc."""
    class DocumentType(models.TextChoices):
        SERVICE_AGREEMENT = 'SERVICE_AGREEMENT', 'Service Agreement'
        NIC = 'NIC', 'NIC/ID Document'
        EDUCATION_CERT = 'EDUCATION_CERT', 'Education Certificate'
        MEDICAL_CERT = 'MEDICAL_CERT', 'Medical Certificate'
        BANK_STATEMENT = 'BANK_STATEMENT', 'Bank Statement'
        OTHER = 'OTHER', 'Other'

    staff = models.ForeignKey(
        StaffMember,
        on_delete=models.CASCADE,
        related_name='documents',
    )
    document_type = models.CharField(max_length=30, choices=DocumentType.choices)
    document_url = models.URLField(help_text="Supabase storage URL")
    uploaded_date = models.DateField(auto_now_add=True)
    expiry_date = models.DateField(null=True, blank=True)
    is_verified = models.BooleanField(default=False)
    verified_by = models.ForeignKey(
        'users.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ['-uploaded_date']
        verbose_name = 'Staff Document'
        verbose_name_plural = 'Staff Documents'

    def __str__(self):
        return f"{self.staff.full_name} — {self.get_document_type_display()}"
```

### 3.3 Model Modifications to Existing Tables

#### 3.3.1 Modify `UserSchoolMembership` — [`backend/schools/models.py:25-71`](backend/schools/models.py#L25-L71)

Add department/subject assignment:

```python
# Add these fields to UserSchoolMembership
department = models.ForeignKey(
    'hr.StaffDepartment',
    on_delete=models.SET_NULL,
    null=True,
    blank=True,
    help_text="Department assignment for this user in this school",
)
is_department_head = models.BooleanField(default=False)
```

#### 3.3.2 Enable HR module via `School.enabled_modules` — [`backend/schools/models.py:139-143`](backend/schools/models.py#L139-L143)

No model change needed. Use existing `enabled_modules` JSONField:

```python
# Example: Enable HR for a school
school.enabled_modules = {
    'attendance_ai': True,
    'whatsapp': True,
    'hr': True,       # NEW — enables HR module visibility
    'payroll': True,   # NEW — enables payroll features within HR
}
```

### 3.4 Database Schema Diagram

```
StaffMember (Core — backend/hr/models.py)
├── StaffDepartment (N:1)
├── StaffDesignation (N:1)
├── School (N:1) — same tenant FK as all other models
├── User (1:1, optional) — links to backend/users/models.py
└── Related:
    ├── SalaryStructure (1:1)
    ├── StaffQualification (1:N)
    ├── StaffDocument (1:N)
    ├── StaffAttendance (1:N) — NOT the same as AttendanceRecord in backend/attendance/
    ├── LeaveApplication (1:N)
    ├── Payslip (1:N)
    └── PerformanceAppraisal (1:N)

LeavePolicy (School Config)
└── Referenced by LeaveApplication (for balance calculation)

SalaryStructure → Payslip (snapshot at generation time)

Finance Integration:
└── Payslip.is_paid → auto-create Expense(category='SALARY') in backend/finance/
```

---

## Part 4: API ENDPOINTS FOR HR MODULE

> All endpoints follow existing project patterns:
> - DRF ViewSets with `TenantQuerySetMixin` (see [`backend/core/mixins.py`](backend/core/mixins.py))
> - URL prefix: `/api/hr/` (registered in [`backend/config/urls.py`](backend/config/urls.py))
> - Authentication: JWT via SimpleJWT (same as all existing endpoints)
> - School isolation via `X-School-ID` header (same as attendance/finance)

### 4.1 Staff Management

```
POST   /api/hr/staff/                              Create new staff member
GET    /api/hr/staff/                              List all staff (with filters)
GET    /api/hr/staff/{id}/                         Get staff details
PATCH  /api/hr/staff/{id}/                         Update staff details
DELETE /api/hr/staff/{id}/                         Soft-delete (set is_active=False)

# Filters (same pattern as finance/fee-payments)
GET    /api/hr/staff/?department={id}              Filter by department
GET    /api/hr/staff/?designation={id}             Filter by designation
GET    /api/hr/staff/?staff_type=PERMANENT         Filter by staff type
GET    /api/hr/staff/?is_active=true               Filter active only
GET    /api/hr/staff/?search=John                  Search by name/email

# Bulk Operations
POST   /api/hr/staff/bulk-import/                  Bulk import staff (CSV/Excel)
GET    /api/hr/staff/export/                       Export staff list (Excel/PDF)
```

### 4.2 Departments & Designations

```
# Departments
POST   /api/hr/departments/                        Create department
GET    /api/hr/departments/                        List departments
PATCH  /api/hr/departments/{id}/                   Update department
DELETE /api/hr/departments/{id}/                   Delete department

# Designations
POST   /api/hr/designations/                       Create designation
GET    /api/hr/designations/                       List designations
PATCH  /api/hr/designations/{id}/                  Update designation
DELETE /api/hr/designations/{id}/                  Delete designation
```

### 4.3 Salary & Payroll

```
# Salary Structure
POST   /api/hr/salary-structures/                  Create salary structure
GET    /api/hr/salary-structures/                  List all (admin) or own (staff)
GET    /api/hr/salary-structures/{staff_id}/       Get salary structure for staff
PATCH  /api/hr/salary-structures/{staff_id}/       Update salary structure

# Payslips
POST   /api/hr/payslips/batch-generate/            Generate payslips for month (Celery task)
GET    /api/hr/payslips/?month=2&year=2026         List payslips for month
GET    /api/hr/payslips/{id}/                      Get payslip details
PATCH  /api/hr/payslips/{id}/approve/              Approve payslip
PATCH  /api/hr/payslips/{id}/mark-paid/            Mark as paid → auto-create finance Expense
GET    /api/hr/payslips/{id}/pdf/                  Download as PDF (jsPDF on frontend)
GET    /api/hr/payslips/staff/{staff_id}/          Payslip history for a staff member

# Reports
GET    /api/hr/reports/payroll-summary/            Monthly payroll summary
GET    /api/hr/reports/salary-comparison/          Compare salary structures
```

### 4.4 Leave Management

```
# Leave Policy
POST   /api/hr/leave-policies/                     Create leave policy
GET    /api/hr/leave-policies/                     Get active policy
PATCH  /api/hr/leave-policies/{id}/                Update policy

# Leave Applications
POST   /api/hr/leave-applications/                 Apply for leave
GET    /api/hr/leave-applications/                 List applications (filtered by role)
GET    /api/hr/leave-applications/{id}/            Get application details
GET    /api/hr/leave-applications/my/              My applications (any staff)
GET    /api/hr/leave-applications/pending/         Pending approvals (HR/Admin)
PATCH  /api/hr/leave-applications/{id}/approve/    Approve
PATCH  /api/hr/leave-applications/{id}/reject/     Reject
PATCH  /api/hr/leave-applications/{id}/cancel/     Cancel

# Leave Balance
GET    /api/hr/leave-balance/{staff_id}/           Get leave balance
GET    /api/hr/leave-balance/                      All staff balances (HR/Admin)
```

### 4.5 Staff Attendance

```
POST   /api/hr/attendance/                         Mark attendance (single or batch)
GET    /api/hr/attendance/?date=2026-02-12         Get attendance for date
PATCH  /api/hr/attendance/{id}/                    Update attendance record
GET    /api/hr/attendance/summary/                 Monthly attendance summary
GET    /api/hr/attendance/staff/{staff_id}/        Staff attendance history
```

### 4.6 Performance Appraisals

```
POST   /api/hr/appraisals/                         Create appraisal
GET    /api/hr/appraisals/?staff_id={id}           Get staff appraisals
PATCH  /api/hr/appraisals/{id}/                    Update appraisal
PATCH  /api/hr/appraisals/{id}/mark-discussed/     Mark as discussed with staff
```

### 4.7 Documents & Qualifications

```
# Qualifications
POST   /api/hr/qualifications/                     Add qualification
GET    /api/hr/qualifications/?staff_id={id}       Get staff qualifications
PATCH  /api/hr/qualifications/{id}/                Update
DELETE /api/hr/qualifications/{id}/                Delete

# Documents (uploaded to Supabase, same bucket pattern as attendance)
POST   /api/hr/documents/upload/                   Upload document
GET    /api/hr/documents/?staff_id={id}            Get staff documents
PATCH  /api/hr/documents/{id}/verify/              Verify document
DELETE /api/hr/documents/{id}/                     Delete
```

### 4.8 HR Dashboard

```
GET    /api/hr/dashboard/                          HR dashboard summary:
                                                   - Total staff count by status
                                                   - Department breakdown
                                                   - Pending leave applications
                                                   - Monthly payroll total
                                                   - Today's attendance summary
```

---

## Part 5: FRONTEND COMPONENTS

> All frontend follows existing project patterns:
> - React + Vite + Tailwind CSS (see [`frontend/vite.config.js`](frontend/vite.config.js), [`frontend/tailwind.config.js`](frontend/tailwind.config.js))
> - TanStack React Query for server state (same as existing pages)
> - Axios API client at [`frontend/src/services/api.js`](frontend/src/services/api.js) with JWT interceptor
> - AuthContext for role checks at [`frontend/src/contexts/AuthContext.jsx`](frontend/src/contexts/AuthContext.jsx)
> - Layout sidebar groups at [`frontend/src/components/Layout.jsx:191-236`](frontend/src/components/Layout.jsx#L191-L236)

### 5.1 New Routes — Add to [`frontend/src/App.jsx`](frontend/src/App.jsx)

```jsx
{/* HR routes — inside the protected Layout route */}
<Route path="hr" element={<SchoolRoute><HRDashboardPage /></SchoolRoute>} />
<Route path="hr/staff" element={<SchoolRoute><StaffDirectoryPage /></SchoolRoute>} />
<Route path="hr/staff/new" element={<SchoolRoute><StaffFormPage /></SchoolRoute>} />
<Route path="hr/staff/:id" element={<SchoolRoute><StaffDetailPage /></SchoolRoute>} />
<Route path="hr/staff/:id/edit" element={<SchoolRoute><StaffFormPage /></SchoolRoute>} />
<Route path="hr/departments" element={<SchoolRoute><DepartmentsPage /></SchoolRoute>} />
<Route path="hr/salary" element={<SchoolRoute><SalaryStructuresPage /></SchoolRoute>} />
<Route path="hr/payslips" element={<SchoolRoute><PayslipManagementPage /></SchoolRoute>} />
<Route path="hr/leave" element={<SchoolRoute><LeaveManagementPage /></SchoolRoute>} />
<Route path="hr/leave/policy" element={<SchoolRoute><LeavePolicyPage /></SchoolRoute>} />
<Route path="hr/attendance" element={<SchoolRoute><StaffAttendancePage /></SchoolRoute>} />
<Route path="hr/appraisals" element={<SchoolRoute><AppraisalsPage /></SchoolRoute>} />
<Route path="hr/reports" element={<SchoolRoute><HRReportsPage /></SchoolRoute>} />
```

### 5.2 Sidebar Navigation — Add to [`frontend/src/components/Layout.jsx:191`](frontend/src/components/Layout.jsx#L191)

Add a new `HR` group between the Finance and Management groups:

```javascript
// HR group (visible to SCHOOL_ADMIN, HR_MANAGER, PRINCIPAL)
...(isHRManager || isSchoolAdmin || isPrincipal ? [{
  type: 'group',
  name: 'HR & Staff',
  icon: BriefcaseIcon,  // new icon
  children: [
    { name: 'Dashboard', href: '/hr', icon: ChartIcon },
    { name: 'Staff Directory', href: '/hr/staff', icon: UsersIcon },
    { name: 'Departments', href: '/hr/departments', icon: FolderIcon },
    { name: 'Salary & Payroll', href: '/hr/salary', icon: BanknotesIcon },
    { name: 'Payslips', href: '/hr/payslips', icon: ReceiptIcon },
    { name: 'Leave Management', href: '/hr/leave', icon: CalendarIcon },
    { name: 'Staff Attendance', href: '/hr/attendance', icon: ClipboardCheckIcon },
    { name: 'Performance', href: '/hr/appraisals', icon: ChartIcon },
    ...(isHRManager || isSchoolAdmin
      ? [{ name: 'Reports', href: '/hr/reports', icon: ReportIcon }]
      : []),
  ],
}] : []),
```

### 5.3 New Pages to Create — `frontend/src/pages/hr/`

```
frontend/src/pages/hr/
├── HRDashboardPage.jsx          # KPI cards: staff count, pending leaves, payroll status
├── StaffDirectoryPage.jsx       # Searchable/filterable staff list with avatar grid
├── StaffFormPage.jsx            # Create/edit staff form (multi-step)
├── StaffDetailPage.jsx          # Staff profile: personal, employment, salary, leaves, docs
├── DepartmentsPage.jsx          # Department & designation management (CRUD tables)
├── SalaryStructuresPage.jsx     # Salary configuration per staff
├── PayslipManagementPage.jsx    # Generate, view, approve, download payslips
├── LeaveManagementPage.jsx      # Leave applications, approvals, balance view
├── LeavePolicyPage.jsx          # Configure leave types and rules
├── StaffAttendancePage.jsx      # Daily attendance marking grid
├── AppraisalsPage.jsx           # Performance review forms and history
└── HRReportsPage.jsx            # Staff register, payroll summary, leave analytics
```

### 5.4 Key UI Components — `frontend/src/components/hr/`

| Component | Purpose | Pattern Reference |
|-----------|---------|-------------------|
| **StaffCard** | Staff avatar + name + department card | Similar to student rows in `StudentsPage.jsx` |
| **StaffForm** | Multi-step form for staff details | Similar to settings forms in `SettingsPage.jsx` |
| **SalaryBreakdownCard** | Visual salary component breakdown | Similar to `FeeSummaryCards.jsx` |
| **PayslipPDF** | PDF generation for payslips | Use jsPDF (already in project — see `feeExport.js`) |
| **LeaveApplicationForm** | Apply for leave with date picker | Standard Tailwind form |
| **LeaveApprovalCard** | Approve/reject with comments | Similar to attendance review cards |
| **AttendanceGrid** | Checkbox grid for daily marking | Similar to `CaptureReviewPage.jsx` attendance grid |
| **AppraisalForm** | Star ratings + text feedback | Standard form |
| **HRSummaryCards** | Dashboard KPI cards | Same pattern as `FinanceDashboardPage.jsx` summary cards |

### 5.5 Mobile Responsiveness

All HR screens follow existing Tailwind responsive patterns:
- `grid-cols-1 md:grid-cols-2 lg:grid-cols-4` for KPI cards
- `lg:hidden` / `hidden lg:block` for sidebar toggle
- Tables use horizontal scroll on mobile (`overflow-x-auto`)

---

## Part 6: PERMISSION & ACCESS CONTROL

### 6.1 New Permission Classes — `backend/hr/permissions.py`

Follow the pattern in [`backend/core/permissions.py`](backend/core/permissions.py):

```python
from core.permissions import get_effective_role, ADMIN_ROLES

HR_ROLES = ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'HR_MANAGER')
HR_READ_ROLES = ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'HR_MANAGER', 'PRINCIPAL')
PAYROLL_ROLES = ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'HR_MANAGER', 'ACCOUNTANT')


class CanManageStaff(permissions.BasePermission):
    """HR_MANAGER + SCHOOL_ADMIN can manage staff. PRINCIPAL can view."""
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        role = get_effective_role(request)
        if role in HR_ROLES:
            return True
        if role in ('PRINCIPAL',) and request.method in permissions.SAFE_METHODS:
            return True
        return False


class CanManagePayroll(permissions.BasePermission):
    """HR_MANAGER, ACCOUNTANT, SCHOOL_ADMIN can manage payroll."""
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        role = get_effective_role(request)
        return role in PAYROLL_ROLES


class CanApplyLeave(permissions.BasePermission):
    """Any authenticated staff can apply for leave."""
    def has_permission(self, request, view):
        return request.user.is_authenticated


class CanApproveLeave(permissions.BasePermission):
    """HR_MANAGER, PRINCIPAL, SCHOOL_ADMIN can approve leave."""
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        role = get_effective_role(request)
        return role in HR_READ_ROLES


class CanViewOwnRecords(permissions.BasePermission):
    """Staff can view own payslips, leave balance, attendance."""
    def has_object_permission(self, request, view, obj):
        if get_effective_role(request) in HR_ROLES:
            return True
        # Staff can only see their own records
        staff_profile = getattr(request.user, 'staff_profile', None)
        if staff_profile and hasattr(obj, 'staff_id'):
            return obj.staff_id == staff_profile.id
        return False
```

### 6.2 Feature Flag Check

Use existing `School.get_enabled_module()` (see [`backend/schools/models.py:159-161`](backend/schools/models.py#L159-L161)):

```python
# In HR views, check if HR module is enabled for the school
class HRModuleRequiredMixin:
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        school = getattr(request, 'tenant_school', None)
        if school and not school.get_enabled_module('hr'):
            raise PermissionDenied("HR module is not enabled for this school.")
```

---

## Part 7: INTEGRATION WITH EXISTING MODULES

### 7.1 Finance Module Integration

**Location:** [`backend/finance/models.py`](backend/finance/models.py)

**Auto-create Expense when payslip is paid:**

When a payslip is marked as paid (`Payslip.is_paid = True`), automatically create an `Expense` record:

```python
# In hr/services.py
from finance.models import Expense

def mark_payslip_paid(payslip, paid_by, account=None):
    payslip.is_paid = True
    payslip.paid_date = date.today()
    payslip.save()

    # Auto-create finance expense (links HR to Finance module)
    Expense.objects.create(
        school=payslip.school,
        category=Expense.Category.SALARY,    # Uses existing SALARY category
        amount=payslip.net_salary,
        date=payslip.paid_date,
        description=f"Salary — {payslip.staff.full_name} ({payslip.month}/{payslip.year})",
        recorded_by=paid_by,
        account=account,
        is_sensitive=True,    # Hide individual salary from staff view
    )
```

**Monthly payroll summary:** Aggregate payslips and compare with `Expense.objects.filter(category='SALARY')` to ensure consistency.

### 7.2 Attendance Module Integration

**Student attendance:** [`backend/attendance/models.py`](backend/attendance/models.py) — `AttendanceRecord` (AI-processed, per-student)
**Staff attendance:** `backend/hr/models.py` — `StaffAttendance` (manual marking, per-staff)

These are **separate models** with different workflows:
- Student attendance uses OCR/LLM pipeline (upload → process → review → confirm)
- Staff attendance uses simple checkbox marking by HR Manager

**Shared UI patterns:** The staff attendance marking grid should reuse the same Tailwind table patterns from [`frontend/src/pages/CaptureReviewPage.jsx`](frontend/src/pages/CaptureReviewPage.jsx).

**Payslip integration:** When generating payslips, count `StaffAttendance` records to calculate `present_days` and `leave_days`.

### 7.3 Schools Module Integration

**Tenant isolation:** All HR queries use `TenantQuerySetMixin` from [`backend/core/mixins.py`](backend/core/mixins.py):

```python
class StaffMemberViewSet(TenantQuerySetMixin, viewsets.ModelViewSet):
    queryset = StaffMember.objects.all()
    # TenantQuerySetMixin auto-filters by school_id from X-School-ID header
```

**Leave policies are school-specific:** Each school configures its own leave types and allowances via `LeavePolicy.school`.

**Feature flags:** HR module enabled per-school via `School.enabled_modules['hr']`.

### 7.4 Users Module Integration

**User ↔ StaffMember link:** `StaffMember.user` (OneToOneField) links to [`backend/users/models.py:30`](backend/users/models.py#L30) `User`.

**When creating a staff member with login access:**
1. Create `User` with appropriate role
2. Create `UserSchoolMembership` with correct role (TEACHER, HR_MANAGER, etc.)
3. Create `StaffMember` linked to the User

**Self-service:** When a logged-in user accesses `/api/hr/leave-applications/my/`, use `request.user.staff_profile` to filter records.

---

## Part 8: SECURITY CONSIDERATIONS

### 8.1 Data Protection

- All HR data encrypted at rest via database-level encryption
- HTTPS-only API access (enforced by Render deployment)
- Rate limiting on salary/leave endpoints
- Audit logging: who accessed/modified sensitive data, when
- PII masking in logs (don't log full NIC/bank account)
- Document uploads go to Supabase storage (same as attendance images) — never local filesystem

### 8.2 Access Control

- Staff can only view own records (via `CanViewOwnRecords` permission)
- HR Manager can view all staff in school (via `CanManageStaff` permission)
- Accountant can only view salary/payslip (via `CanManagePayroll` permission)
- Principal can approve leaves for own school
- Super Admin can view across schools (via `IsSuperAdmin` permission)
- Finance `Expense` records created from salary are marked `is_sensitive=True` — hidden from STAFF role (existing behavior in [`backend/finance/models.py:399`](backend/finance/models.py#L399))

### 8.3 Compliance

- Payslip generation creates immutable records (cannot edit after approval)
- Tax calculations are auditable
- Leave policy changes tracked with effective dates
- Salary history maintained (never delete, only archive via `is_active=False`)

---

## Part 9: PHASED IMPLEMENTATION ROADMAP

### Phase 1: Core HR Foundation (3-4 weeks)

**Goals:** Basic staff management working

**Deliverables:**
1. Create `backend/hr/` Django app with models, serializers, views
2. Database migrations
3. API endpoints for Staff CRUD, Departments, Designations
4. New permission classes in `hr/permissions.py`
5. Frontend: Staff directory page, Add/edit staff form
6. Sidebar navigation update in `Layout.jsx`
7. New roles (HR_MANAGER, TEACHER, ACCOUNTANT) in `UserSchoolMembership.Role`
8. Feature flag: `School.enabled_modules['hr']`

**Workstreams:**
- [ ] Create `backend/hr/` app with models (1-2 days)
- [ ] Run migrations (0.5 day)
- [ ] Write serializers + ViewSets (1.5 days)
- [ ] Add HR permission classes (1 day)
- [ ] Expand `UserSchoolMembership.Role` enum + migration (0.5 day)
- [ ] Update `AuthContext.jsx` with new role checks (0.5 day)
- [ ] Create frontend pages: `StaffDirectoryPage`, `StaffFormPage`, `StaffDetailPage` (2-3 days)
- [ ] Add HR sidebar group in `Layout.jsx` (0.5 day)
- [ ] Testing (1 day)

**Success Criteria:**
- Can add/edit staff members with department + designation
- Data isolated by school (via `TenantQuerySetMixin`)
- HR_MANAGER has read/write, PRINCIPAL has read-only
- Other roles cannot access HR endpoints

---

### Phase 2: Salary & Payroll (3-4 weeks)

**Goals:** Complete salary structure and payslip generation

**Deliverables:**
1. Salary structure configuration UI
2. Payslip generation engine (Celery batch process via [`backend/config/celery.py`](backend/config/celery.py))
3. Payslip view/download (PDF via jsPDF — same lib as [`frontend/src/pages/fee-collection/feeExport.js`](frontend/src/pages/fee-collection/feeExport.js))
4. Basic payroll report
5. ACCOUNTANT role with salary access
6. Payslip approval workflow
7. Finance integration: auto-create `Expense(category='SALARY')` on payslip payment

**Workstreams:**
- [ ] Salary structure endpoint + serializer (1.5 days)
- [ ] Payslip generation service in `hr/services.py` (2-3 days)
- [ ] Celery task for batch generation in `hr/tasks.py` (1 day)
- [ ] Finance integration: auto-create Expense on payment (0.5 day)
- [ ] Frontend: `SalaryStructuresPage`, `PayslipManagementPage` (2-3 days)
- [ ] PDF export using jsPDF (1 day)
- [ ] Approval workflow (1 day)
- [ ] Testing (1 day)

**Success Criteria:**
- Generate 100+ payslips per batch without errors
- PDF payslips look professional
- Accountant can approve/mark paid
- Salary payment auto-creates `Expense` in Finance module

---

### Phase 3: Leave Management (3-4 weeks)

**Goals:** Complete leave application and approval workflow

**Deliverables:**
1. Leave policy configuration UI
2. Leave application form (staff self-service)
3. Leave approval dashboard (HR Manager, Principal)
4. Leave balance calculator
5. Notification system (email — future: WhatsApp via existing WhatsApp integration)
6. Leave analytics dashboard

**Workstreams:**
- [ ] Leave policy endpoints (1 day)
- [ ] Leave application workflow + balance logic in `hr/services.py` (1.5 days)
- [ ] Approval endpoints with comments (1 day)
- [ ] Frontend: `LeavePolicyPage`, `LeaveManagementPage` (2-3 days)
- [ ] Leave balance calculation logic (1 day)
- [ ] Notification integration (1 day)
- [ ] Testing (1 day)

**Success Criteria:**
- Staff can apply for leave with date range
- HR can approve/reject with comments
- Leave balance updates correctly
- Cannot exceed allotted days

---

### Phase 4: Staff Attendance & Performance (3-4 weeks)

**Goals:** Staff attendance marking and performance tracking

**Deliverables:**
1. Staff attendance marking UI (checkbox grid — separate from student AI attendance)
2. Attendance reports & summary
3. Performance appraisal form
4. Appraisal review workflow
5. Integration: link attendance to payslip calculation (`present_days`)

**Workstreams:**
- [ ] Staff attendance model/API (1.5 days)
- [ ] Attendance marking grid UI (1.5 days)
- [ ] Attendance summary reports (1 day)
- [ ] Appraisal form/API (2 days)
- [ ] Frontend: `StaffAttendancePage`, `AppraisalsPage` (2 days)
- [ ] Link attendance → payslip present_days (1 day)
- [ ] Testing (1 day)

**Success Criteria:**
- Can mark attendance for each staff per day
- Attendance linked to payslip calculation
- Can create appraisals with ratings

---

### Phase 5: Documents & Qualifications (2-3 weeks)

**Goals:** Staff document management

**Deliverables:**
1. Qualification tracking
2. Document upload to Supabase (same bucket pattern as attendance uploads)
3. Verification workflow
4. Expiry date tracking
5. Compliance dashboard

**Workstreams:**
- [ ] Qualification/document models/API (1 day)
- [ ] Supabase upload integration (reuse pattern from [`backend/attendance/views.py`](backend/attendance/views.py)) (1 day)
- [ ] Verification workflow (1 day)
- [ ] Frontend document manager in `StaffDetailPage` (1.5 days)
- [ ] Expiry notification logic (1 day)
- [ ] Testing (0.5 day)

---

### Phase 6: Analytics, Reports & Bulk Operations (2-3 weeks)

**Goals:** HR dashboard and advanced reporting

**Deliverables:**
1. HR dashboard with KPIs (same card pattern as [`frontend/src/pages/FinanceDashboardPage.jsx`](frontend/src/pages/FinanceDashboardPage.jsx))
2. Staff register export (Excel via XLSX lib — already in project)
3. Payroll summary report
4. Leave analytics
5. Turnover analysis
6. Bulk staff import (CSV)

**Workstreams:**
- [ ] Dashboard API endpoint (1.5 days)
- [ ] Report generation endpoints (2 days)
- [ ] Excel/PDF export (reuse `feeExport.js` patterns) (1 day)
- [ ] Bulk import endpoint (1 day)
- [ ] Frontend: `HRDashboardPage`, `HRReportsPage` (2 days)
- [ ] Testing (0.5 day)

---

## Part 10: ESTIMATED TIMELINE & RESOURCES

### 10.1 Full HR Module Timeline

| Phase | Duration | Scope | Status |
|-------|----------|-------|--------|
| **Phase 1** | 3-4 weeks | Staff CRUD, Departments, Roles | Not started |
| **Phase 2** | 3-4 weeks | Salary & Payroll + Finance integration | Not started |
| **Phase 3** | 3-4 weeks | Leave Management | Not started |
| **Phase 4** | 3-4 weeks | Staff Attendance + Performance | Not started |
| **Phase 5** | 2-3 weeks | Documents & Qualifications | Not started |
| **Phase 6** | 2-3 weeks | Reports, Dashboard, Bulk Ops | Not started |
| **TOTAL** | **16-20 weeks (~4-5 months)** | | |

### 10.2 Tech Stack (All Existing)

| Layer | Technology | Already in Project |
|-------|-----------|-------------------|
| Backend | Django 6.0.1 + DRF 3.16.1 | Yes |
| Auth | SimpleJWT | Yes |
| Task Queue | Celery 5.6.2 + Redis | Yes |
| File Storage | Supabase | Yes |
| Frontend | React 18 + Vite 6 + Tailwind 3 | Yes |
| Server State | TanStack React Query 5 | Yes |
| Charts | Recharts 3.7 | Yes |
| PDF Export | jsPDF 4.1 + AutoTable | Yes |
| Excel Export | XLSX 0.18.5 | Yes |

**No new dependencies required** — all tools needed are already in the project.

---

## Part 11: TECHNICAL CONSIDERATIONS

### 11.1 Performance

**Bulk Salary Calculation:**
- Use Celery task (see existing pattern in [`backend/attendance/tasks.py`](backend/attendance/tasks.py))
- Cache salary components to avoid N+1 queries
- Index on `(staff, month, year)` for payslip lookups

**Reporting Queries:**
- Use `select_related('department', 'designation')` on StaffMember queries
- Cache dashboard aggregations (invalidate monthly)

**File Uploads:**
- Max 5-10 MB per document
- Store in Supabase storage (same as attendance uploads — see [`backend/attendance/views.py`](backend/attendance/views.py) upload handling)

### 11.2 Testing Strategy

Follow existing test patterns:
- Unit tests: Model logic, permission checks, salary calculations
- Integration tests: API endpoints with various roles
- E2E tests: Full workflows (staff creation → payslip → approval → finance expense)
- Edge cases: Leap years, tax thresholds, leave carryforward logic

---

## Part 12: FUTURE ENHANCEMENTS (Post-MVP)

### Quick Wins (1-2 weeks each)
- Performance bonus calculation
- Attendance-based salary deduction
- Leave encashment at year-end
- Staff contract auto-renewal reminders
- Salary increment workflow

### Medium Complexity (2-4 weeks each)
- WhatsApp notifications for leave approval/rejection (reuse existing WhatsApp integration in [`backend/attendance/services.py`](backend/attendance/services.py))
- Staff self-service portal
- Biometric attendance integration
- Gratuity calculation

### Complex Features (4+ weeks each)
- HRIS integration
- Tax compliance auto-filing (Pakistan FBR)
- Bank API integration for salary disbursement
- ML-based performance prediction

---

## QUESTIONS FOR CLARIFICATION

Before implementation, clarify:

1. **Tax Compliance:** Should payslips include Pakistan FBR tax calculations? Or leave as configurable deductions?
2. **Salary Components:** Fixed list (base + allowances + deductions) or fully custom per school?
3. **Leave Policies:** Per-designation (teachers get different days than admin) or unified per school?
4. **Staff Portal:** Should staff view own payslips, or only HR/Accountant can view?
5. **Approval Workflow:** Should Principal approve payslips before payment?
6. **Mobile:** Keep everything in the existing dashboard or build a separate mobile-friendly view?

---

**Document Status:** Ready for Review | **Last Updated:** Feb 12, 2026
