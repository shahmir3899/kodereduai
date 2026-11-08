"""The two model providers behind the assistant: Groq and Cerebras.

Both speak the OpenAI chat-completions dialect, so one small httpx client serves both. Using
httpx directly (not the Groq SDK) matters for two reasons: the SDK silently retries a 429 with its
own back-off (seconds lost, invisible to us), and it hides the response headers that say how much
budget is left. Keys come from the environment only and are never logged.
"""
import logging
import re

import httpx
from django.conf import settings

logger = logging.getLogger(__name__)

GROQ = 'groq'
CEREBRAS = 'cerebras'

BASE_URLS = {
    GROQ: 'https://api.groq.com/openai/v1',
    CEREBRAS: 'https://api.cerebras.ai/v1',
}
DEFAULT_TIMEOUT = 40.0


class ProviderError(Exception):
    """A provider call failed. `kind` tells the gateway what to do next:
    rate_limit -> rest this provider until `retry_after` and use the other
    server / network -> rest it briefly and use the other
    bad_request -> the request itself was refused (e.g. a malformed tool call): retry once, then give up on it
    auth -> misconfigured key: never retry on this provider"""

    def __init__(self, provider, kind, message, status=None, retry_after=None):
        super().__init__(f'{provider}: {message}')
        self.provider, self.kind, self.status, self.retry_after = provider, kind, status, retry_after


def api_key(provider):
    return settings.GROQ_API_KEY if provider == GROQ else settings.CEREBRAS_API_KEY


def model_for(provider, tier='main'):
    """The model id for a provider and tier. A blank fast model means "same as main"."""
    if provider == GROQ:
        main, fast = settings.GROQ_MODEL, getattr(settings, 'GROQ_FAST_MODEL', '')
    else:
        main, fast = settings.CEREBRAS_MODEL, getattr(settings, 'CEREBRAS_FAST_MODEL', '')
    return (fast or main) if tier == 'fast' else main


def reasoning_effort_for(provider):
    """'low' keeps answers quick. Blank omits the field (for a model that rejects it)."""
    value = settings.GROQ_REASONING_EFFORT if provider == GROQ else settings.CEREBRAS_REASONING_EFFORT
    return value or None


def max_tokens_param(provider):
    return settings.GROQ_MAX_TOKENS_PARAM if provider == GROQ else settings.CEREBRAS_MAX_TOKENS_PARAM


_RETRY_IN = re.compile(r'try again in\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:([\d.]+)s)?', re.IGNORECASE)


def parse_retry_after(headers, message=''):
    """Seconds to wait, from `retry-after` or from text like "try again in 5m41.28s". None if unknown."""
    raw = (headers or {}).get('retry-after')
    if raw:
        try:
            return max(float(raw), 1.0)
        except ValueError:
            pass
    match = _RETRY_IN.search(message or '')
    if match and any(match.groups()):
        h, m, s = (float(g) if g else 0.0 for g in match.groups())
        return max(h * 3600 + m * 60 + s, 1.0)
    return None


def parse_duration(text):
    """"6s", "1m30.5s", "2h" or a plain number of seconds -> seconds, or None."""
    if text is None:
        return None
    text = str(text).strip()
    try:
        return float(text)
    except ValueError:
        pass
    match = re.fullmatch(r'(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?(?:([\d.]+)ms)?', text)
    if not match or not any(match.groups()):
        return None
    h, m, s, ms = (float(g) if g else 0.0 for g in match.groups())
    return h * 3600 + m * 60 + s + ms / 1000


def _classify(provider, response):
    try:
        body = response.json()
        message = (body.get('error') or {}).get('message') if isinstance(body.get('error'), dict) else str(body)[:300]
    except Exception:
        message = response.text[:300]
    message = message or f'HTTP {response.status_code}'
    status = response.status_code
    retry_after = parse_retry_after(response.headers, message)
    if status == 429:
        return ProviderError(provider, 'rate_limit', message[:300], status, retry_after)
    if status in (401, 403):
        # A 403 is often not the key at all (e.g. "model blocked at the project level"), so keep the
        # provider's own reason - minus the key, in case an error body ever echoed it.
        key = api_key(provider)
        reason = (message.replace(key, '***') if key else message) if status == 403 else 'the API key was refused'
        return ProviderError(provider, 'auth', reason[:300], status)
    if status >= 500:
        return ProviderError(provider, 'server', message[:300], status)
    return ProviderError(provider, 'bad_request', message[:300], status)


def _headers(provider):
    key = api_key(provider)
    return {'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}


def post_chat(provider, payload, timeout=DEFAULT_TIMEOUT):
    """POST /chat/completions. Returns (json, response_headers) or raises ProviderError.
    This is the only function that talks to a model API, so tests patch it (and a tripwire guards it)."""
    try:
        response = httpx.post(f'{BASE_URLS[provider]}/chat/completions', json=payload, headers=_headers(provider), timeout=timeout)
    except httpx.TimeoutException:
        raise ProviderError(provider, 'server', 'timed out')
    except httpx.HTTPError as exc:
        raise ProviderError(provider, 'server', f'network error: {type(exc).__name__}')
    if response.status_code != 200:
        raise _classify(provider, response)
    try:
        return response.json(), dict(response.headers)
    except ValueError:
        raise ProviderError(provider, 'server', 'invalid JSON in the response')


def list_models(provider, timeout=15.0):
    """GET /models: the model ids this key can use (used by the probe)."""
    try:
        response = httpx.get(f'{BASE_URLS[provider]}/models', headers=_headers(provider), timeout=timeout)
    except httpx.HTTPError as exc:
        raise ProviderError(provider, 'server', f'network error: {type(exc).__name__}')
    if response.status_code != 200:
        raise _classify(provider, response)
    data = response.json()
    return sorted(m.get('id', '') for m in data.get('data', data if isinstance(data, list) else []))


def post_transcription(audio, filename, content_type, model, language='', prompt='', timeout=60.0):
    """POST /audio/transcriptions (Groq Whisper). Returns the verbose_json dict (text, language, duration).
    Speech-to-text exists only on Groq here; Cerebras has no audio API. Like post_chat, this is the single
    function that sends audio out, so tests patch it and the test tripwire guards it. The audio is only held
    in memory for the request - never written to disk or logged."""
    data = {'model': model, 'response_format': 'verbose_json', 'temperature': '0'}
    if language:
        data['language'] = language
    if prompt:
        data['prompt'] = prompt
    headers = {'Authorization': f'Bearer {api_key(GROQ)}'}
    try:
        response = httpx.post(f'{BASE_URLS[GROQ]}/audio/transcriptions', data=data, headers=headers,
                              files={'file': (filename, audio, content_type)}, timeout=timeout)
    except httpx.TimeoutException:
        raise ProviderError(GROQ, 'server', 'timed out')
    except httpx.HTTPError as exc:
        raise ProviderError(GROQ, 'server', f'network error: {type(exc).__name__}')
    if response.status_code != 200:
        raise _classify(GROQ, response)
    try:
        return response.json()
    except ValueError:
        raise ProviderError(GROQ, 'server', 'invalid JSON in the response')

