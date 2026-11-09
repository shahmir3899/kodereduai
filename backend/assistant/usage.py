"""Who used the model, and how much; plus the per-school switch.

Recording is best effort on purpose: counting must never turn an answer into an error, so every
write is wrapped and only logged when it fails.
"""
import logging
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone as dt_timezone

from django.conf import settings
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.db.models import F, Sum
from django.utils import timezone

logger = logging.getLogger(__name__)

# Set around a model call (not across a generator's yields), so llm.complete keeps its signature
# and every test double for it keeps working.
_scope = ContextVar('assistant_usage_scope', default=None)
EXTERNAL_TTL = 8 * 24 * 3600


@contextmanager
def scope(school_id, user_id):
    token = _scope.set((school_id, user_id) if school_id and user_id else None)
    try:
        yield
    finally:
        _scope.reset(token)


def today():
    return timezone.localdate()


# ── the per-school switch ────────────────────────────────────────────────────

def assistant_enabled(school_id) -> bool:
    """School.ai_config['assistant_enabled'] wins; when it is missing the deployment default decides
    (EDU_ASSISTANT_DEFAULT_ENABLED), so a production rollout can start with everything off."""
    from schools.models import School

    cfg = School.objects.filter(pk=school_id).values_list('ai_config', flat=True).first()
    if isinstance(cfg, dict) and 'assistant_enabled' in cfg:
        return bool(cfg['assistant_enabled'])
    return bool(settings.ASSISTANT_DEFAULT_ENABLED)


def set_assistant_enabled(school, enabled: bool):
    cfg = dict(school.ai_config or {})
    cfg['assistant_enabled'] = bool(enabled)
    school.ai_config = cfg
    school.save(update_fields=['ai_config', 'updated_at'])


# ── recording ────────────────────────────────────────────────────────────────

def _bump(school_id, user_id, **deltas):
    from .models import AgentUsageDay

    day = today()
    rows = AgentUsageDay.objects.filter(school_id=school_id, user_id=user_id, date=day)
    values = {k: F(k) + v for k, v in deltas.items()}
    if rows.update(**values):
        return
    try:
        with transaction.atomic():      # savepoint: a lost race must not poison the caller's transaction
            AgentUsageDay.objects.create(school_id=school_id, user_id=user_id, date=day, **deltas)
    except IntegrityError:
        rows.update(**values)


def record_call(tokens, fallback=False):
    """Called by llm.complete after a successful call. No scope (router for an unknown user, tests) = not recorded."""
    current = _scope.get()
    if not current:
        return
    try:
        _bump(current[0], current[1], tokens=int(tokens or 0), calls=1, fallbacks=1 if fallback else 0)
    except Exception:
        logger.warning('usage not recorded', exc_info=True)


def record_voice(school_id, user_id, seconds):
    try:
        _bump(school_id, user_id, voice_seconds=int(round(seconds or 0)))
    except Exception:
        logger.warning('voice usage not recorded', exc_info=True)


def record_external(tag, response, provider='groq'):
    """Count a call made OUTSIDE the gateway (the older per-feature Groq calls) so the shared daily
    budget is visible. Takes the SDK response object or the JSON dict. Never raises."""
    try:
        usage = response.get('usage') if isinstance(response, dict) else getattr(response, 'usage', None)
        total = usage.get('total_tokens') if isinstance(usage, dict) else getattr(usage, 'total_tokens', 0)
        total = int(total or 0)
        day = datetime.now(dt_timezone.utc).strftime('%Y-%m-%d')
        for key, amount in ((f'llm:ext:{tag}:tokens:{day}', total), (f'llm:ext:{tag}:calls:{day}', 1)):
            try:
                cache.incr(key, amount)
            except ValueError:
                cache.set(key, amount, EXTERNAL_TTL)
        from . import llm
        llm.count_tokens(provider, total)      # keeps the provider's daily total honest
    except Exception:
        logger.debug('external usage not recorded', exc_info=True)


def external_today(tag, day=None):
    day = day or datetime.now(dt_timezone.utc).strftime('%Y-%m-%d')
    try:
        return int(cache.get(f'llm:ext:{tag}:tokens:{day}') or 0), int(cache.get(f'llm:ext:{tag}:calls:{day}') or 0)
    except Exception:
        return 0, 0


# ── caps ─────────────────────────────────────────────────────────────────────

ADMIN_ROLES = {'SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL'}


def user_cap(role):
    return settings.ADMIN_DAILY_TOKENS if role in ADMIN_ROLES else settings.USER_DAILY_TOKENS


def user_tokens_today(user_id):
    """All schools together: a person with two schools still has one allowance."""
    from .models import AgentUsageDay

    return AgentUsageDay.objects.filter(user_id=user_id, date=today()).aggregate(t=Sum('tokens'))['t'] or 0


# ── the older per-feature Groq calls ─────────────────────────────────────────

def patch_groq_sdk():
    """Count every call made through the Groq SDK, tagged with the module that made it.

    About 17 older features call Groq directly and share its 200k tokens/day with the assistant, but
    nothing showed how much they spend. Wrapping the one SDK method gives that number without touching
    each call site; moving them onto the gateway is decided from these numbers. The gateway itself talks
    plain HTTP, so nothing is counted twice."""
    import sys

    try:
        from groq.resources.chat.completions import Completions
    except Exception:
        return
    if getattr(Completions.create, '_edu_counted', False):
        return
    original = Completions.create

    def counted(self, *args, **kwargs):
        response = original(self, *args, **kwargs)
        try:
            tag = sys._getframe(1).f_globals.get('__name__', 'unknown')
            if not kwargs.get('stream'):
                record_external(tag, response)
        except Exception:
            pass
        return response

    counted._edu_counted = True
    Completions.create = counted
