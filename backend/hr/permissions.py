"""
HR-specific permission classes.
"""

from rest_framework import permissions
from core.permissions import get_effective_role, ADMIN_ROLES


HR_WRITE_ROLES = ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL', 'MANAGER')


class IsManagerOrAdminOrReadOnly(permissions.BasePermission):
    """
    Managers and Admins get full CRUD access.
    All other authenticated roles get read-only access.
    """
    message = 'Only Managers and Admins can modify HR data.'

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


class CanManageOwnLeaveApplication(permissions.BasePermission):
    """
    Leave application access policy — adds genuine Teacher self-service on
    top of the existing admin/Manager access, without letting Teacher touch
    anyone else's leave:
    - HR_WRITE_ROLES (admins + Manager): full read/write, including
      approve/reject for any staff member.
    - TEACHER, STAFF: read (queryset scoped to their own record in
      get_queryset), `create` (perform_create forces staff_member to their
      own profile, overriding whatever was submitted), and `cancel` — but
      only their own (has_object_permission below), and never
      `approve`/`reject`.
    - Everyone else authenticated: read-only, same as before.
    """
    message = "You don't have permission to manage this leave application."

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False

        role = get_effective_role(request)

        if request.method in permissions.SAFE_METHODS:
            return True

        if role in HR_WRITE_ROLES:
            return True

        if role in ('TEACHER', 'STAFF'):
            # create/cancel only — approve/reject/update/destroy stay
            # admin-only. Ownership of the specific object for `cancel` is
            # enforced in has_object_permission below, not here.
            return getattr(view, 'action', None) in ('create', 'cancel')

        return False

    def has_object_permission(self, request, view, obj):
        role = get_effective_role(request)

        if role in HR_WRITE_ROLES:
            return True

        if request.method in permissions.SAFE_METHODS:
            return True

        if role in ('TEACHER', 'STAFF') and view.action == 'cancel':
            return getattr(obj.staff_member, 'user_id', None) == request.user.id

        return False
