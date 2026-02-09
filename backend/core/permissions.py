"""
Custom permission classes for role-based and tenant-based access control.
"""

from rest_framework import permissions
from core.mixins import ensure_tenant_schools


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
    Permission class that allows School Admins (and Super Admins).
    Use for school-level management endpoints.
    """
    message = "Only School Admins can perform this action."

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False

        return (
            request.user.is_super_admin or
            request.user.is_school_admin
        )


class IsSchoolAdminOrReadOnly(permissions.BasePermission):
    """
    School Admins can edit, others can only read.
    """
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False

        if request.method in permissions.SAFE_METHODS:
            return True

        return (
            request.user.is_super_admin or
            request.user.is_school_admin
        )


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


class CanManageAttendance(permissions.BasePermission):
    """
    Permission for attendance-related operations.
    School Admins and Staff with attendance permissions can manage.
    """
    message = "You don't have permission to manage attendance."

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False

        if request.user.is_super_admin or request.user.is_school_admin:
            return True

        # Staff can view but not modify
        if request.user.is_staff_member:
            return request.method in permissions.SAFE_METHODS

        return False


class CanConfirmAttendance(permissions.BasePermission):
    """
    Only School Admins can confirm attendance uploads.
    This is a critical action that creates permanent records.
    """
    message = "Only School Admins can confirm attendance."

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False

        return (
            request.user.is_super_admin or
            request.user.is_school_admin
        )
