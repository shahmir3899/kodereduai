"""
Cache invalidation for the inventory dashboard summary (InventoryDashboardView
in inventory/views.py). Signals fire on every .save()/.delete() of the models
the dashboard aggregates over, regardless of which view/action triggered it —
see hr/signals.py for the fuller rationale (same pattern, applied here too).
"""
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.core.cache import cache

from inventory.models import (
    InventoryItem,
    ItemAssignment,
    InventoryCategory,
    Vendor,
    StockTransaction,
)


def bust_inventory_dashboard_cache(school_id):
    if school_id:
        cache.delete(f'inventory:dashboard:{school_id}')


@receiver([post_save, post_delete], sender=InventoryItem)
def _inventory_item_changed(sender, instance, **kwargs):
    bust_inventory_dashboard_cache(instance.school_id)


@receiver([post_save, post_delete], sender=ItemAssignment)
def _item_assignment_changed(sender, instance, **kwargs):
    bust_inventory_dashboard_cache(instance.school_id)


@receiver([post_save, post_delete], sender=InventoryCategory)
def _inventory_category_changed(sender, instance, **kwargs):
    bust_inventory_dashboard_cache(instance.school_id)


@receiver([post_save, post_delete], sender=Vendor)
def _vendor_changed(sender, instance, **kwargs):
    bust_inventory_dashboard_cache(instance.school_id)


@receiver([post_save, post_delete], sender=StockTransaction)
def _stock_transaction_changed(sender, instance, **kwargs):
    bust_inventory_dashboard_cache(instance.school_id)
