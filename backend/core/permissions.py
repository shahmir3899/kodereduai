"""
Custom permission classes for role-based and tenant-based access control.
"""

from rest_framework import permissions
from django.db.models import Q
from core.mixins import ensure_tenant_schools, ensure_tenant_school_id

# Roles that have admin-level access (full read + write).
# Used across all permission classes to avoid repeating role tuples.
ADMIN_ROLES = ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL')

# Roles that are staff-level (non-admin). These get read-only access to
# existing modules (finance, attendance) and are subject to sensitive-data filtering.
STAFF_LEVEL_ROLES = ('STAFF', 'TEACHER', 'HR_MANAGER', 'ACCOUNTANT', 'DRIVER')
PARENT_ROLES = ('PARENT',)
STUDENT_ROLES = ('STUDENT',)

# Which roles each role is allowed to create
ROLE_HIERARCHY = {
    'SUPER_ADMIN': ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL', 'HR_MANAGER', 'ACCOUNTANT', 'TEACHER', 'STAFF', 'DRIVER'],
    'SCHOOL_ADMIN': ['PRINCIPAL', 'HR_MANAGER', 'ACCOUNTANT', 'TEACHER', 'STAFF', 'DRIVER'],
    'PRINCIPAL': ['HR_MANAGER', 'ACCOUNTANT', 'TEACHER', 'STAFF', 'DRIVER'],
}


def _resolve_scope_academic_year_id(request, school_id):
    """Resolve academic year for teacher scope checks.

    Priority: query param academic_year -> current school year -> None.
    """
    academic_year_id = request.query_params.get('academic_year')
    if academic_year_id:
        return int(academic_year_id)

    from academic_sessions.models import AcademicYear
    current_year = AcademicYear.objects.filter(
        school_id=school_id,
        is_current=True,
        is_active=True,
    ).only('id').first()
    return current_year.id if current_year else None


def get_teacher_class_scope(request, school_id=None, academic_year_id=None):
    """Return master class IDs where current teacher is assigned as class teacher.
    
    This resolves SessionClass assignments to master Class IDs for backward compatibility.
    For section-aware filtering, use get_teacher_session_class_scope() instead.
    """
    user = request.user
    if not user.is_authenticated:
        return set()

    school_id = school_id or ensure_tenant_school_id(request) or user.school_id
    if not school_id:
        return set()

    academic_year_id = academic_year_id or _resolve_scope_academic_year_id(request, school_id)

    from academics.models import ClassTeacherAssignment
    queryset = ClassTeacherAssignment.objects.filter(
        school_id=school_id,
        teacher__user=user,
        is_active=True,
    )
    if academic_year_id:
        queryset = queryset.filter(
            Q(academic_year_id=academic_year_id) | Q(academic_year__isnull=True)
        )

    # Resolve SessionClass to master Class, deduplicate
    return set(queryset.values_list('class_obj_id', flat=True).distinct())


def get_teacher_session_class_scope(request, school_id=None, academic_year_id=None):
    """Return SessionClass IDs where current teacher is assigned.
    
    Returns section-level granularity: if teacher assigned to Class 2-A and Class 2-B,
    returns both session class IDs (not just master class 2).
    
    Use this for true section-scoped access control.
    """
    user = request.user
    if not user.is_authenticated:
        return set()

    school_id = school_id or ensure_tenant_school_id(request) or user.school_id
    if not school_id:
        return set()

    academic_year_id = academic_year_id or _resolve_scope_academic_year_id(request, school_id)

    from academics.models import ClassTeacherAssignment
    queryset = ClassTeacherAssignment.objects.filter(
        school_id=school_id,
        teacher__user=user,
        is_active=True,
        session_class__isnull=False,  # Only return assignments with session_class
    )
    if academic_year_id:
        queryset = queryset.filter(
            Q(academic_year_id=academic_year_id) | Q(academic_year__isnull=True)
        )

    return set(queryset.values_list('session_class_id', flat=True).distinct())



def get_teacher_subject_scope(request, school_id=None, academic_year_id=None):
    """Return subject-teacher scope as class_ids and class->subject map."""
    user = request.user
    if not user.is_authenticated:
        return {'class_ids': set(), 'class_subject_map': {}}

    school_id = school_id or ensure_tenant_school_id(request) or user.school_id
    if not school_id:
        return {'class_ids': set(), 'class_subject_map': {}}

    academic_year_id = academic_year_id or _resolve_scope_academic_year_id(request, school_id)

    from academics.models import ClassSubject
    queryset = ClassSubject.objects.filter(
        school_id=school_id,
        teacher__user=user,
        is_active=True,
    )
    if academic_year_id:
        queryset = queryset.filter(
            Q(academic_year_id=academic_year_id) | Q(academic_year__isnull=True)
        )

    class_subject_map = {}
    for class_id, subject_id in queryset.values_list('class_obj_id', 'subject_id'):
        class_subject_map.setdefault(class_id, set()).add(subject_id)

    return {
        'class_ids': set(class_subject_map.keys()),
        'class_subject_map': class_subject_map,
    }

def _get_session_class_student_ids(session_class_ids, academic_year_id=None):
    """
    Given a set of session_class IDs, return the set of student IDs enrolled
    in those sessions. Used by multiple modules for section-scoped filtering.
    """
    from academic_sessions.models import StudentEnrollment
    qs = StudentEnrollment.objects.filter(
        session_class_id__in=session_class_ids,
        is_active=True,
    )
    if academic_year_id:
        qs = qs.filter(academic_year_id=academic_year_id)
    return set(qs.values_list('student_id', flat=True).distinct())

def get_teacher_combined_scope(request, school_id=None, academic_year_id=None):
    """Return combined class-teacher and subject-teacher scope.
    
    Returns both master class level (backward compat) and session class level (section-scoped).
    This allows endpoints to choose the granularity they need.
    """
    class_teacher_class_ids = get_teacher_class_scope(
        request,
        school_id=school_id,
        academic_year_id=academic_year_id,
    )
    class_teacher_session_class_ids = get_teacher_session_class_scope(
        request,
        school_id=school_id,
        academic_year_id=academic_year_id,
    )
    subject_scope = get_teacher_subject_scope(
        request,
        school_id=school_id,
        academic_year_id=academic_year_id,
    )

    return {
        # Master class level (for backward compatibility)
        'full_class_ids': class_teacher_class_ids,
        # Session class level (for section-scoped filtering)
        'full_session_class_ids': class_teacher_session_class_ids,
        # Subject-teacher scope (master class level)
        'subject_class_ids': subject_scope['class_ids'],
        'class_subject_map': subject_scope['class_subject_map'],
        # Combined master class level
        'all_class_ids': class_teacher_class_ids.union(subject_scope['class_ids']),
    }


def _is_data_restricted_user(request):
    """
    Check if current user has data-restricted access (PRINCIPAL + staff roles).
    These roles cannot see sensitive financial data.
    """
    role = get_effective_role(request)
    # Include PRINCIPAL with staff for sensitive data hiding
    data_restricted = STAFF_LEVEL_ROLES + ('PRINCIPAL',)
    return role in data_restricted


def get_effective_role(request):
    """
    Return the user's effective role for the current active school.
    Uses membership role, falling back to User.role for backward compat.
    """
    user = request.user
    if not user.is_authenticated:
        return None
    if user.is_super_admin:
        return 'SUPER_ADMIN'

    school_id = ensure_tenant_school_id(request)
    if school_id:
        role = user.get_role_for_school(school_id)
        if role:
            return role

    # Fallback to User.role
    return user.role


class IsSuperAdmin(permissions.BasePermission):
    """
    Permission class that only allows Super Admins.
    Use for platform-wide management endpoints.
    """
    message = "Only Super Admins can perform this action."

    def has_permission(self, request, view):
        return (
            request.user.is_authenticated and
            request.user.is_super_admin
        )


class IsSchoolAdmin(permissions.BasePermission):
    """
    Permission class that allows School Admins, Principals (and Super Admins).
    Uses membership role for the active school.
    """
    message = "Only School Admins can perform this action."

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False

        role = get_effective_role(request)
        return role in ADMIN_ROLES


class IsSchoolAdminOrReadOnly(permissions.BasePermission):
    """
    School Admins/Principals can edit, others can only read.
    Uses membership role for the active school.
    """
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False

        if request.method in permissions.SAFE_METHODS:
            return True

        role = get_effective_role(request)
        return role in ADMIN_ROLES


class HasSchoolAccess(permissions.BasePermission):
    """
    Permission class that checks if user has access to a specific school.
    Used for endpoints that operate on school-specific resources.
    """
    message = "You don't have access to this school's data."

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False

        # Super admin has access to all
        if request.user.is_super_admin:
            return True

        # Ensure tenant_schools is populated (handles JWT auth timing)
        tenant_schools = ensure_tenant_schools(request)

        # Check if school_id is in the request
        school_id = (
            view.kwargs.get('school_id') or
            request.query_params.get('school_id') or
            request.data.get('school_id') or
            request.data.get('school')
        )

        if school_id:
            return int(school_id) in tenant_schools

        # If no school_id specified, allow (queryset will filter)
        return True

    def has_object_permission(self, request, view, obj):
        """Check object-level permission for tenant resources."""
        if request.user.is_super_admin:
            return True

        # Get school_id from object
        school_id = getattr(obj, 'school_id', None)
        if school_id is None and hasattr(obj, 'school'):
            school_id = obj.school.id if obj.school else None

        if school_id is None:
            return True

        # Ensure tenant_schools is populated (handles JWT auth timing)
        tenant_schools = ensure_tenant_schools(request)
        return school_id in tenant_schools


class IsSchoolAdminOrStaffReadOnly(permissions.BasePermission):
    """
    School Admins/Principals get full access. Staff members get read-only access.
    Used for finance endpoints where staff can view but not modify.
    """
    message = "Staff members have read-only access to finance data."

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False

        role = get_effective_role(request)
        if role in ADMIN_ROLES:
            return True

        # Staff-level roles can only read
        if role in STAFF_LEVEL_ROLES:
            return request.method in permissions.SAFE_METHODS

        return False


class CanManageAttendance(permissions.BasePermission):
    """
    Permission for attendance-related operations.
    Admins/Principals get full access, Staff-level roles get read-only.
    """
    message = "You don't have permission to manage attendance."

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False

        role = get_effective_role(request)
        if role in ADMIN_ROLES:
            return True

        if role in STAFF_LEVEL_ROLES:
            return request.method in permissions.SAFE_METHODS

        return False


class CanConfirmAttendance(permissions.BasePermission):
    """
    Admins/Principals and Teachers can confirm attendance uploads.
    Teachers can only confirm uploads for their assigned classes (enforced in view).
    """
    message = "You don't have permission to confirm attendance."

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False

        role = get_effective_role(request)
        return role in ADMIN_ROLES or role == 'TEACHER'


class CanUploadAttendance(permissions.BasePermission):
    """
    Permission for uploading attendance images and managing uploads.
    - SUPER_ADMIN, SCHOOL_ADMIN, PRINCIPAL: full access to all classes
    - TEACHER: can upload for assigned classes only (enforced in view)
    """
    message = "You don't have permission to upload attendance."

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        role = get_effective_role(request)
        return role in ADMIN_ROLES or role == 'TEACHER'


class CanManualAttendance(permissions.BasePermission):
    """
    Permission for manual attendance entry.
    - SUPER_ADMIN, SCHOOL_ADMIN, PRINCIPAL: can mark any class
    - TEACHER: can mark assigned classes only (enforced in view)
    """
    message = "You don't have permission to enter manual attendance."

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        role = get_effective_role(request)
        return role in ADMIN_ROLES or role == 'TEACHER'


class IsDriverOrAdmin(permissions.BasePermission):
    """Allow drivers (for journey operations) or admins."""
    message = "Only drivers or admins can perform this action."

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        role = get_effective_role(request)
        return role in ADMIN_ROLES or role == 'DRIVER'


class IsParent(permissions.BasePermission):
    """Permission class that only allows Parent users."""
    message = "Only parents can perform this action."

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        role = get_effective_role(request)
        return role in PARENT_ROLES


class IsParentOrAdmin(permissions.BasePermission):
    """Allow parents (own data) or admins (all data)."""
    message = "Only parents or admins can perform this action."

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        role = get_effective_role(request)
        return role in ADMIN_ROLES or role in PARENT_ROLES


class IsStudent(permissions.BasePermission):
    """Permission class that only allows Student users."""
    message = "Only students can perform this action."

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        role = get_effective_role(request)
        return role in STUDENT_ROLES


class IsStudentOrAdmin(permissions.BasePermission):
    """Allow students (own data) or admins (all data)."""
    message = "Only students or admins can perform this action."

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        role = get_effective_role(request)
        return role in ADMIN_ROLES or role in STUDENT_ROLES


class ModuleAccessMixin:
    """
    DRF ViewSet mixin that gates access based on the school's enabled modules.
    Set `required_module` on the ViewSet class.

    Example:
        class StaffViewSet(ModuleAccessMixin, ModelViewSet):
            required_module = 'hr'

    Returns 403 if the module is disabled for the current school.
    Super admins bypass this check (they access admin endpoints, not school endpoints).
    """
    required_module = None

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if self.required_module and not request.user.is_super_admin:
            school = getattr(request, 'tenant_school', None)
            if school and not school.get_enabled_module(self.required_module):
                from rest_framework.exceptions import PermissionDenied
                from core.module_registry import MODULE_REGISTRY
                label = MODULE_REGISTRY.get(self.required_module, {}).get('label', self.required_module)
                raise PermissionDenied(
                    f"The {label} module is not enabled for this school."
                )
