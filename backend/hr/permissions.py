"""
HR-specific permission classes.
"""

from rest_framework import permissions
from core.permissions import get_effective_role, ADMIN_ROLES


HR_WRITE_ROLES = ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL')

# Roles that get self-service read/write (own record only, enforced in each
# viewset's get_queryset) on the leave/attendance/payslip endpoints, even
# though they have no write access to the rest of HR.
HR_SELF_SERVICE_ROLES = ('TEACHER', 'STAFF', 'MANAGER')


class IsManagerOrAdminOrReadOnly(permissions.BasePermission):
    """
    Admins get full CRUD access. TEACHER/STAFF/MANAGER get read-only access,
    scoped to their own record by each viewset's get_queryset (self-service:
    Payslip, StaffAttendance, LeavePolicy read). Everyone else authenticated
    gets read-only too.

    2026-09: Manager's HR footprint was cut down to this self-service set
    only (see IsAdminOnlyOrReadOnly below for the rest of HR, which Manager
    no longer sees at all) — Manager used to be a full HR_WRITE_ROLES member.
    """
    message = 'Only Admins can modify HR data.'

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


class IsAdminOnlyOrReadOnly(permissions.BasePermission):
    """
    Admins get full CRUD. TEACHER/STAFF get read-only. MANAGER gets nothing.

    2026-09: Manager's HR access was scoped down to self-service only
    (own payslip/leave/attendance — see IsManagerOrAdminOrReadOnly above).
    This guards the rest of HR — staff directory, departments, designations,
    salary structure, leave policy config, appraisals, qualifications,
    documents — none of which is part of that self-service set, so Manager
    is blocked outright rather than falling back to read-only.
    """
    message = 'Only Admins can access this HR data.'

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False

        role = get_effective_role(request)
        if role == 'MANAGER':
            return False

        if role in HR_WRITE_ROLES:
            return True

        if request.method in permissions.SAFE_METHODS:
            return True

        return False


class CanManageOwnLeaveApplication(permissions.BasePermission):
    """
    Leave application access policy — adds genuine Teacher self-service on
    top of the existing admin access, without letting Teacher touch anyone
    else's leave:
    - HR_WRITE_ROLES (admins only, 2026-09: Manager removed): full
      read/write, including approve/reject for any staff member.
    - TEACHER, STAFF, MANAGER (HR_SELF_SERVICE_ROLES): read (queryset scoped
      to their own record in get_queryset), `create` (perform_create forces
      staff_member to their own profile, overriding whatever was submitted),
      and `cancel` — but only their own (has_object_permission below), and
      never `approve`/`reject`. Manager joined this self-service tier in
      2026-09 after losing full HR_WRITE_ROLES access.
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

        if role in HR_SELF_SERVICE_ROLES:
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

        if role in HR_SELF_SERVICE_ROLES and view.action == 'cancel':
            return getattr(obj.staff_member, 'user_id', None) == request.user.id

        return False
