"""Voice support: speech to text (Groq Whisper) and the short spoken version of a reply.

Rules this module keeps:
  * Audio is held in memory for one request, never written to disk. Only its size and duration are
    logged - never the audio or the words.
  * Voice is for people who can use the assistant at all: the view checks that before any audio leaves.
  * Each user has a daily allowance (transcriptions plus spoken rewrites) so one person cannot spend
    the shared Groq budget.
  * Silence is not a command. Whisper tends to invent "thank you" from quiet audio, so a clip it
    itself marks as no-speech comes back empty.
"""
import logging
import time
from datetime import datetime, timezone

from django.conf import settings
from django.core.cache import cache

from . import llm, providers, usage
from .providers import ProviderError

logger = logging.getLogger(__name__)

MAX_SECONDS = 60                       # the client stops recording here
MIN_SECONDS = 0.4                      # shorter than this is a mis-tap
NO_SPEECH = 0.6                        # Whisper's own "this is not speech" probability
SPOKEN_INPUT_MAX = 1500

# Browsers label the recording by container: Chrome/Firefox webm or ogg, Safari mp4.
EXTENSIONS = {
    'audio/webm': 'webm', 'video/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
    'audio/m4a': 'm4a', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
    'audio/flac': 'flac',
}
LANGUAGES = {'': '', 'auto': '', 'ur': 'ur', 'en': 'en'}


class VoiceUnavailable(Exception):
    """Safe to show the user."""


class VoiceLimit(Exception):
    pass


def available():
    return bool(settings.VOICE_ENABLED and providers.api_key(providers.GROQ))


def normalise_type(content_type):
    return (content_type or '').split(';')[0].strip().lower()


def _limit_key(user):
    return f'voice:{user.pk}:{datetime.now(timezone.utc).strftime("%Y-%m-%d")}'


def count_use(user):
    """Count one use; raise VoiceLimit past the daily allowance. A broken cache never blocks voice."""
    allowance = settings.VOICE_DAILY_PER_USER
    if allowance <= 0:
        return
    key = _limit_key(user)
    try:
        cache.add(key, 0, 90000)
        used = cache.incr(key)
    except Exception:
        return
    if used > allowance:
        raise VoiceLimit()


def transcribe(audio: bytes, content_type: str, language: str = '', usage_for=None) -> dict:
    ctype = normalise_type(content_type)
    started = time.monotonic()
    try:
        data = providers.post_transcription(
            audio, f'speech.{EXTENSIONS[ctype]}', ctype, settings.STT_MODEL,
            language=LANGUAGES.get(language, '') or settings.STT_LANGUAGE, prompt=settings.STT_PROMPT)
    except ProviderError as exc:
        logger.warning('stt failed kind=%s status=%s: %s', exc.kind, exc.status, exc)      # the provider's reason, never the audio
        if exc.kind == 'rate_limit':
            raise VoiceUnavailable('Voice is busy right now. Please try again in a minute or type your message.')
        if exc.kind == 'bad_request':
            raise VoiceUnavailable('That recording could not be read. Please try again.')
        if exc.kind == 'auth':
            raise VoiceUnavailable('Voice is not enabled for this school yet. Please type your message.')
        raise VoiceUnavailable('Voice is not available right now. Please type your message.')
    duration = float(data.get('duration') or 0)
    text = (data.get('text') or '').strip()
    segments = data.get('segments') or []
    if duration and duration < MIN_SECONDS:
        text = ''
    elif segments and all((s.get('no_speech_prob') or 0) > NO_SPEECH for s in segments):
        text = ''
    logger.info('stt model=%s bytes=%d seconds=%.1f ms=%d empty=%s', settings.STT_MODEL, len(audio), duration,
                (time.monotonic() - started) * 1000, not text)
    if usage_for:       # (school_id, user_id): voice minutes are a cost too
        usage.record_voice(usage_for[0], usage_for[1], duration)
    return {'text': text, 'language': data.get('language') or '', 'duration': round(duration, 1)}


SPOKEN_PROMPT = (
    'Rewrite a school assistant reply so it can be read aloud. Rules: at most two short sentences; keep every number, '
    'amount and name exactly; no tables, lists, markdown or emoji; say how many things there are instead of listing them all. '
    'If the reply is in Urdu or Roman Urdu, write the spoken version in Urdu script (names too). If it is in English, '
    'keep English. Reply with the spoken text only.')


def spoken_version(text: str, usage_for=None) -> str:
    """A short version of a reply for text-to-speech. Uses the small, cheap model tier."""
    try:
        with usage.scope(*(usage_for or (None, None))):
            reply = llm.complete(
                [{'role': 'system', 'content': SPOKEN_PROMPT}, {'role': 'user', 'content': text[:SPOKEN_INPUT_MAX]}],
                max_tokens=160, temperature=0.2, retries=0, tier='fast')
    except llm.LLMUnavailable:
        raise VoiceUnavailable('Could not prepare the spoken version right now.')
    return reply.content.strip()
