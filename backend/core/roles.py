"""
Single source of truth for roles.

Why this exists: the same role list used to be hand-copied into permissions, user views, the
frontend AuthContext, several forms and the mobile app, and the copies drifted. Everything now
imports from here, and the API serves `role_config()` so clients never keep their own list.

Finance access is not a role (2026-11): it is `can_manage_finance=True` on a MANAGER membership.
Old data used a separate finance-only role value; migrations moved it. Never reintroduce one.
"""

SUPER_ADMIN = 'SUPER_ADMIN'
SCHOOL_ADMIN = 'SCHOOL_ADMIN'
PRINCIPAL = 'PRINCIPAL'
MANAGER = 'MANAGER'
TEACHER = 'TEACHER'
STAFF = 'STAFF'
DRIVER = 'DRIVER'
PARENT = 'PARENT'
STUDENT = 'STUDENT'

# (value, label, group). Order is display order.
ROLE_DEFS = (
    (SUPER_ADMIN, 'Super Admin', 'admin'),
    (SCHOOL_ADMIN, 'School Admin', 'admin'),
    (PRINCIPAL, 'Principal', 'admin'),
    (MANAGER, 'Manager', 'staff'),
    (TEACHER, 'Teacher', 'staff'),
    (STAFF, 'Staff', 'staff'),
    (DRIVER, 'Driver', 'staff'),
    (PARENT, 'Parent', 'portal'),
    (STUDENT, 'Student', 'portal'),
)

ROLE_LABELS = {value: label for value, label, _ in ROLE_DEFS}

# Roles that have admin-level access (full read + write).
ADMIN_ROLES = tuple(v for v, _, g in ROLE_DEFS if g == 'admin')

# Roles that are staff-level (non-admin): read-only on most modules and subject to
# sensitive-data filtering.
STAFF_LEVEL_ROLES = tuple(v for v, _, g in ROLE_DEFS if g == 'staff')
PARENT_ROLES = (PARENT,)
STUDENT_ROLES = (STUDENT,)

# Roles assignable per school membership (SUPER_ADMIN is platform level, never per school).
MEMBERSHIP_ROLES = tuple(v for v, _, _ in ROLE_DEFS if v != SUPER_ADMIN)

# Which roles each role is allowed to create. Portal roles are never creatable here.
ROLE_HIERARCHY = {
    SUPER_ADMIN: [SUPER_ADMIN, SCHOOL_ADMIN, PRINCIPAL, MANAGER, TEACHER, STAFF, DRIVER],
    SCHOOL_ADMIN: [PRINCIPAL, MANAGER, TEACHER, STAFF, DRIVER],
    PRINCIPAL: [MANAGER, TEACHER, STAFF, DRIVER],
}

# Capability flags stored on the membership. They are extra powers on top of a role, which is
# how finance access exists without being a role of its own.
CAPABILITY_FLAGS = {
    'can_manage_finance': 'Finance and fees',
}


def role_config():
    """JSON-safe role list for API clients (web and mobile)."""
    return {
        'roles': [{'value': v, 'label': label, 'group': g} for v, label, g in ROLE_DEFS],
        'creatable': {role: list(allowed) for role, allowed in ROLE_HIERARCHY.items()},
        'capabilities': [{'key': k, 'label': label} for k, label in CAPABILITY_FLAGS.items()],
    }
