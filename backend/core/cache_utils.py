"""
Response caching for read-only GET endpoints, invalidated by version keys.

Every cached response embeds the current version of each data group it depends
on (`ver_<group>`). A model change bumps that group's version, which orphans
every cached variant at once — no wildcard deletes, so it behaves identically
on Redis and LocMem (`delete_pattern` is Redis-only and a silent no-op elsewhere).

Never use this for money/live data (fees, payments, balances, payroll totals,
attendance being taken now) or for any GET that writes.

Limits: signals don't fire for bulk_create()/queryset.update()/bulk_update();
those paths are only covered by the TTL.
"""
import functools
import hashlib
import json
import time

from django.core.cache import cache
from django.db.models.signals import m2m_changed, post_delete, post_save
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response


def _version_key(group):
    return f'ver_{group}'


def bump_group(group):
    # Timestamp rather than n+1: if the counter is evicted, an n+1 counter would
    # restart at a value that old entries may still be keyed under.
    cache.set(_version_key(group), time.time_ns(), None)


def _find_request(args):
    # @api_view functions get (request, ...); ViewSet/APIView methods get (self, request, ...).
    for arg in args:
        if hasattr(arg, 'method') and hasattr(arg, 'query_params'):
            return arg
    return None


def cached_api(*groups, timeout=120, per_user=True):
    """
    Cache a GET view's 200 response. Apply UNDER @api_view/@permission_classes
    (or directly on an APIView.get / ViewSet action) so authentication and
    permission checks run before any cache lookup.
    """
    version_keys = [_version_key(g) for g in groups]

    def decorator(view):
        @functools.wraps(view)
        def wrapper(*args, **kwargs):
            request = _find_request(args)
            if request is None or request.method != 'GET':
                return view(*args, **kwargs)

            versions = cache.get_many(version_keys)
            raw_key = json.dumps([
                view.__qualname__,
                request.user.pk if per_user else None,
                # The active school comes from a header, not the query string.
                request.headers.get('X-School-ID'),
                sorted(request.query_params.lists()),
                [versions.get(k, 0) for k in version_keys],
                sorted(kwargs.items(), key=lambda kv: kv[0]),
            ], default=str)
            key = 'api:' + hashlib.md5(raw_key.encode()).hexdigest()

            cached = cache.get(key)
            if cached is not None:
                return Response(cached)

            response = view(*args, **kwargs)
            if getattr(response, 'status_code', None) == 200 and hasattr(response, 'data'):
                # Round-trip through the renderer so only plain data is stored and
                # values (dates, decimals) look exactly as the client receives them.
                cache.set(key, json.loads(JSONRenderer().render(response.data)), timeout)
            return response

        return wrapper

    return decorator


def invalidate_group_on_change(group, *models, m2m=()):
    """Bump `group` whenever any of `models` is saved/deleted or an m2m `through` model changes."""
    def _bump(sender, **kwargs):
        bump_group(group)

    for model in models:
        label = model._meta.label
        post_save.connect(_bump, sender=model, weak=False, dispatch_uid=f'cache:{group}:{label}:save')
        post_delete.connect(_bump, sender=model, weak=False, dispatch_uid=f'cache:{group}:{label}:delete')
    for through in m2m:
        m2m_changed.connect(_bump, sender=through, weak=False, dispatch_uid=f'cache:{group}:{through._meta.label}:m2m')
