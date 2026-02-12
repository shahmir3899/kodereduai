"""
HR-specific permission classes.
"""

from rest_framework import permissions
from core.permissions import get_effective_role, ADMIN_ROLES


HR_WRITE_ROLES = ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL', 'HR_MANAGER')


class IsHRManagerOrAdminOrReadOnly(permissions.BasePermission):
    """
    HR Managers and Admins get full CRUD access.
    All other authenticated roles get read-only access.
    """
    message = 'Only HR Managers and Admins can modify HR data.'

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False

        role = get_effective_role(request)
        if role in HR_WRITE_ROLES:
            return True

        # All other authenticated users: read-only
        if request.method in permissions.SAFE_METHODS:
            return True

        return False
