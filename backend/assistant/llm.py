"""The model gateway for the assistant: one `complete()` call, two providers behind it.

Lean by design - primary with fallback, no balancing maths:
  * `main` calls (the tool loop, big prompts) go to LLM_PRIMARY first, `fast` calls (router,
    summaries: tiny prompts) go to the OTHER provider first, so Cerebras' 5 requests/minute are
    kept for the calls that need its 90K tokens/minute.
  * A 429 or an outage rests that provider (for as long as it asked) and the call moves to the
    other one. If both are resting the user gets the normal "temporarily unavailable" answer.
  * Rest state and the request guard are per server process: no shared-cache traffic per call.
    The only shared write is one counter increment per call (tokens used today).
  * Kill switch: EDU_LLM_CEREBRAS_ENABLED=false makes this Groq-only again.
Tests mock `complete` (and a tripwire guards `providers.post_chat`).
"""
import json
import logging
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone

from django.conf import settings
from django.core.cache import cache

from . import providers, usage
from .providers import CEREBRAS, GROQ, ProviderError

logger = logging.getLogger(__name__)

DEFAULT_REST_SECONDS = 60.0         # a 429 that does not say how long
SERVER_REST_SECONDS = 20.0          # an outage or timeout
MAX_REST_SECONDS = 3600.0
COUNTER_TTL = 2 * 24 * 3600


@dataclass
class LLMReply:
    content: str = ''
    # [{id, name, arguments (dict or None if unparseable), raw_arguments (str)}]
    tool_calls: list = field(default_factory=list)
    provider: str = ''
    model: str = ''
    usage: dict = field(default_factory=dict)


class LLMUnavailable(Exception):
    pass


_lock = threading.Lock()
_resting_until = {}                  # provider -> time.monotonic() when it may be used again
_recent_cerebras = deque()           # monotonic timestamps of Cerebras requests in the last minute


# ── provider choice ──────────────────────────────────────────────────────────

def configured(provider):
    if not providers.api_key(provider):
        return False
    return settings.LLM_CEREBRAS_ENABLED if provider == CEREBRAS else True


def order_for(tier):
    primary = settings.LLM_PRIMARY if settings.LLM_PRIMARY in (GROQ, CEREBRAS) else CEREBRAS
    other = GROQ if primary == CEREBRAS else CEREBRAS
    order = [primary, other]
    if tier == 'fast' and primary == CEREBRAS:
        order = [GROQ, CEREBRAS]           # spend Groq's cheap requests on small calls
    return [p for p in order if configured(p)]


def rest_remaining(provider):
    with _lock:
        return max(_resting_until.get(provider, 0.0) - time.monotonic(), 0.0)


def rest(provider, seconds):
    seconds = min(max(seconds, 1.0), MAX_REST_SECONDS)
    with _lock:
        _resting_until[provider] = time.monotonic() + seconds
    logger.warning('llm provider %s resting for %.0fs', provider, seconds)


def _guard_blocks(provider):
    """True when this process has already used the provider's per-minute request allowance."""
    if provider != CEREBRAS or settings.LLM_CEREBRAS_RPM <= 0:
        return False
    cutoff = time.monotonic() - 60.0
    with _lock:
        while _recent_cerebras and _recent_cerebras[0] < cutoff:
            _recent_cerebras.popleft()
        return len(_recent_cerebras) >= settings.LLM_CEREBRAS_RPM


def _note_request(provider):
    if provider == CEREBRAS:
        with _lock:
            _recent_cerebras.append(time.monotonic())


def reset_state():
    """For tests and `llm_status --reset`."""
    with _lock:
        _resting_until.clear()
        _recent_cerebras.clear()
        _last_limits.clear()


# ── what the server says is left ─────────────────────────────────────────────

_last_limits = {}                    # provider -> {header: value} from the latest answer (this process)
LOW_TOKENS = 1500                    # below this many tokens left in a window, stop sending big prompts there


def _int(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _learn_from_headers(provider, headers):
    """Rest a provider the moment the server reports an empty window, instead of finding out by a 429.
    Cerebras reports remaining requests/tokens per minute, hour and day; Groq reports remaining requests
    and tokens plus when each resets."""
    h = {str(k).lower(): v for k, v in (headers or {}).items() if str(k).lower().startswith('x-ratelimit')}
    if not h:
        return
    with _lock:
        _last_limits[provider] = h
    if provider == CEREBRAS:
        if _int(h.get('x-ratelimit-remaining-tokens-day')) is not None and _int(h['x-ratelimit-remaining-tokens-day']) < LOW_TOKENS:
            rest(provider, MAX_REST_SECONDS)                       # the day's budget is spent
        elif _int(h.get('x-ratelimit-remaining-requests-minute')) == 0:
            rest(provider, 30.0)
        elif _int(h.get('x-ratelimit-remaining-tokens-minute')) is not None and _int(h['x-ratelimit-remaining-tokens-minute']) < LOW_TOKENS:
            rest(provider, 20.0)
    else:
        if _int(h.get('x-ratelimit-remaining-requests')) == 0:
            rest(provider, providers.parse_duration(h.get('x-ratelimit-reset-requests')) or DEFAULT_REST_SECONDS)
        elif _int(h.get('x-ratelimit-remaining-tokens')) is not None and _int(h['x-ratelimit-remaining-tokens']) < LOW_TOKENS:
            rest(provider, providers.parse_duration(h.get('x-ratelimit-reset-tokens')) or 10.0)


# ── usage ────────────────────────────────────────────────────────────────────

def usage_key(provider, day=None):
    return f'llm:tokens:{provider}:{day or datetime.now(timezone.utc).strftime("%Y-%m-%d")}'


def count_tokens(provider, total):
    """One cache write per call. Best effort: counting must never break an answer."""
    if not total:
        return
    key = usage_key(provider)
    try:
        cache.incr(key, total)
    except ValueError:
        try:
            cache.set(key, total, COUNTER_TTL)
        except Exception:
            pass
    except Exception:
        pass


def tokens_today(provider):
    try:
        return int(cache.get(usage_key(provider)) or 0)
    except Exception:
        return 0


# ── the call ─────────────────────────────────────────────────────────────────

def _payload(provider, tier, messages, tools, max_tokens, temperature):
    payload = {'model': providers.model_for(provider, tier), 'messages': messages, 'temperature': temperature,
               providers.max_tokens_param(provider): max_tokens}
    effort = providers.reasoning_effort_for(provider)
    if effort:
        payload['reasoning_effort'] = effort
    if tools:
        payload['tools'] = tools
        payload['tool_choice'] = 'auto'
    return payload


def _parse(provider, data, payload):
    message = data['choices'][0]['message']
    calls = []
    for tc in (message.get('tool_calls') or []):
        raw = (tc.get('function') or {}).get('arguments') or '{}'
        try:
            parsed = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            parsed = None
        calls.append({'id': tc.get('id'), 'name': (tc.get('function') or {}).get('name'), 'arguments': parsed, 'raw_arguments': raw})
    # `content` can legitimately be null when the model only emits tool calls.
    return LLMReply(content=(message.get('content') or '').strip(), tool_calls=calls, provider=provider,
                    model=payload['model'], usage=data.get('usage') or {})


def complete(messages, tools=None, max_tokens=1500, temperature=0.3, retries=2, tier='main') -> LLMReply:
    """One model call with native tool calling. `tier` is 'main' (default) or 'fast' (small calls)."""
    order = order_for(tier)
    if not order:
        raise LLMUnavailable('no model provider is configured')
    awake = [p for p in order if rest_remaining(p) <= 0]
    if not awake:
        wait = min(rest_remaining(p) for p in order)
        raise LLMUnavailable(f'every model provider is rate-limited; the first is back in about {int(wait) + 1}s')
    # A provider our own guard says is full goes last, not nowhere: the guard is per process, the server decides.
    plan = [p for p in awake if not _guard_blocks(p)] + [p for p in awake if _guard_blocks(p)]

    last = None
    for index, provider in enumerate(plan):
        payload = _payload(provider, tier, messages, tools, max_tokens, temperature)
        for attempt in range(2 if retries else 1):
            started = time.monotonic()
            try:
                _note_request(provider)
                data, _headers = providers.post_chat(provider, payload)
                reply = _parse(provider, data, payload)
            except ProviderError as exc:
                last = exc
                logger.warning('llm call failed provider=%s kind=%s status=%s: %s', provider, exc.kind, exc.status, exc)
                if exc.kind == 'rate_limit':
                    rest(provider, exc.retry_after or DEFAULT_REST_SECONDS)
                    break
                if exc.kind == 'auth':
                    rest(provider, MAX_REST_SECONDS)
                    break
                if attempt == 0 and retries:             # one quick retry for a hiccup or a malformed tool call
                    time.sleep(0.5)
                    continue
                if exc.kind == 'server':
                    rest(provider, SERVER_REST_SECONDS)
                break
            except (KeyError, IndexError, TypeError, AttributeError) as exc:
                last = ProviderError(provider, 'server', f'unexpected response shape ({type(exc).__name__})')
                break
            _learn_from_headers(provider, _headers)
            total = reply.usage.get('total_tokens') or 0
            count_tokens(provider, total)
            usage.record_call(total, fallback=index > 0)
            logger.info('llm_call provider=%s model=%s tier=%s prompt=%s completion=%s total=%s ms=%d fallback=%s tools=%d',
                        provider, payload['model'], tier, reply.usage.get('prompt_tokens'), reply.usage.get('completion_tokens'),
                        total, (time.monotonic() - started) * 1000, index > 0, len(reply.tool_calls))
            return reply
    raise LLMUnavailable(str(last) if last else 'no provider answered')


def snapshot():
    """Plain facts for `llm_status`: what is configured, what is resting, tokens used today."""
    out = {'primary': settings.LLM_PRIMARY, 'cerebras_enabled': settings.LLM_CEREBRAS_ENABLED, 'providers': {}}
    for provider in (GROQ, CEREBRAS):
        budget = settings.LLM_DAILY_BUDGETS.get(provider) or 0
        used = tokens_today(provider)
        out['providers'][provider] = {
            'configured': configured(provider), 'model': providers.model_for(provider),
            'fast_model': providers.model_for(provider, 'fast'), 'resting_seconds': int(rest_remaining(provider)),
            'tokens_today': used, 'budget': budget, 'server_says': dict(_last_limits.get(provider, {})), 'percent': round(100 * used / budget, 1) if budget else None,
        }
    out['order'] = {tier: order_for(tier) for tier in ('main', 'fast')}
    return out
