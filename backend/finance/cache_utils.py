"""
Cache-versioning helpers for the finance dashboard read endpoints (account
balances, reports). Those responses vary by date range/role/staff-visibility,
so a single `cache.delete(key)` per write can't target every cached variant —
instead each read key embeds a per-school version counter, and any write that
changes finance data bumps the counter (see finance/signals.py), invalidating
every cached variant for that school at once.
"""
from django.core.cache import cache


def finance_cache_version(school_id):
    return cache.get(f'finance:cache-version:{school_id}', 1)


def bust_finance_cache(school_id):
    if not school_id:
        return
    key = f'finance:cache-version:{school_id}'
    try:
        cache.incr(key)
    except ValueError:
        cache.set(key, 2, None)
