"""
Helper for writing to core.AdminActionLog from super-admin dashboard actions.
"""

from .models import AdminActionLog


def log_admin_action(request, action, target, metadata=None):
    """
    Record one super-admin action.

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
