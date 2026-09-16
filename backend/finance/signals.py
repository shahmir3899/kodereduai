"""
Django signals for finance app.
Sibling detection has been removed.

Cache invalidation for the finance dashboard read cache (AccountViewSet.balances,
FinanceReportsView._summary/category_summary) — see finance/cache_utils.py for
why this bumps a version counter instead of deleting exact keys.
"""
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver

from finance.cache_utils import bust_finance_cache
from finance.models import FeePayment, OtherIncome, Expense, Transfer


@receiver([post_save, post_delete], sender=FeePayment)
def _fee_payment_changed(sender, instance, **kwargs):
    bust_finance_cache(instance.school_id)


@receiver([post_save, post_delete], sender=OtherIncome)
def _other_income_changed(sender, instance, **kwargs):
    bust_finance_cache(instance.school_id)


@receiver([post_save, post_delete], sender=Expense)
def _expense_changed(sender, instance, **kwargs):
    bust_finance_cache(instance.school_id)


@receiver([post_save, post_delete], sender=Transfer)
def _transfer_changed(sender, instance, **kwargs):
    bust_finance_cache(instance.school_id)
