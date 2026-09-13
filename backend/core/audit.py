"""
Helper for writing to core.AdminActionLog from admin-facing actions.
"""

from .models import AdminActionLog


def log_admin_action(request, action, target, metadata=None):
    """
    Record one admin action for the audit trail.

    Originally super-admin-only actions (school/org management), now also
    used by school-level admins (e.g. SCHOOL_ADMIN/PRINCIPAL resetting a
    staff member's password) — `actor` just records whoever performed it.
    The feed itself (SuperAdminActionLogViewSet) stays Super-Admin-visible
    only; school admins don't get a UI for it yet.

    `target` is the model instance being acted on (e.g. a School, Organization,
    UserSchoolMembership, or User) — its class name, pk, and str() are captured
    so the log entry stays readable even after the target is later deleted.
    """
    actor = getattr(request, 'user', None)
    AdminActionLog.objects.create(
        actor=actor if actor and actor.is_authenticated else None,
        action=action,
        target_type=type(target).__name__,
        target_id=str(getattr(target, 'pk', '')),
        target_repr=str(target)[:255],
        metadata=metadata,
    )
