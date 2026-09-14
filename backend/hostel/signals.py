"""
Cache invalidation for the hostel dashboard summary (HostelDashboardView in
hostel/views.py). Signals fire on every .save()/.delete() of the models the
dashboard aggregates over, regardless of which view/action triggered it —
see hr/signals.py for the fuller rationale (same pattern, applied here too).
"""
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.core.cache import cache

from hostel.models import Hostel, Room, HostelAllocation, GatePass


def bust_hostel_dashboard_cache(school_id):
    if school_id:
        cache.delete(f'hostel:dashboard:{school_id}')


@receiver([post_save, post_delete], sender=Hostel)
def _hostel_changed(sender, instance, **kwargs):
    bust_hostel_dashboard_cache(instance.school_id)


@receiver([post_save, post_delete], sender=Room)
def _room_changed(sender, instance, **kwargs):
    # Room doesn't carry school_id directly — it hangs off its hostel.
    bust_hostel_dashboard_cache(instance.hostel.school_id)


@receiver([post_save, post_delete], sender=HostelAllocation)
def _hostel_allocation_changed(sender, instance, **kwargs):
    bust_hostel_dashboard_cache(instance.school_id)


@receiver([post_save, post_delete], sender=GatePass)
def _gate_pass_changed(sender, instance, **kwargs):
    bust_hostel_dashboard_cache(instance.school_id)
