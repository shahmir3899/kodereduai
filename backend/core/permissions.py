"""
Custom permission classes for role-based and tenant-based access control.
"""

from rest_framework import permissions
from core.mixins import ensure_tenant_schools, ensure_tenant_school_id

# Roles that have admin-level access (full read + write).
# Used across all permission classes to avoid repeating role tuples.
ADMIN_ROLES = ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL')

# Roles that are staff-level (non-admin). These get read-only access to
# existing modules (finance, attendance) and are subject to sensitive-data filtering.
STAFF_LEVEL_ROLES = ('STAFF', 'TEACHER', 'HR_MANAGER', 'ACCOUNTANT')
PARENT_ROLES = ('PARENT',)
STUDENT_ROLES = ('STUDENT',)

# Which roles each role is allowed to create
ROLE_HIERARCHY = {
    'SUPER_ADMIN': ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL', 'HR_MANAGER', 'ACCOUNTANT', 'TEACHER', 'STAFF'],
    'SCHOOL_ADMIN': ['PRINCIPAL', 'HR_MANAGER', 'ACCOUNTANT', 'TEACHER', 'STAFF'],
    'PRINCIPAL': ['HR_MANAGER', 'ACCOUNTANT', 'TEACHER', 'STAFF'],
}


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
    Only Admins/Principals can confirm attendance uploads.
    This is a critical action that creates permanent records.
    """
    message = "Only School Admins can confirm attendance."

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False

        role = get_effective_role(request)
        return role in ADMIN_ROLES


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
