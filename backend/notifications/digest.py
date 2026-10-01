"""
Daily digest for the dashboard notification carousel.

Only counts and event types ever leave our servers — no student names or
message bodies are sent to the LLM. The summary reads generically; the
carousel shows the specifics on the cards that follow it.
"""

import hashlib
import json
import logging
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db.models import Count
from django.utils import timezone

from .models import NotificationLog, NotificationTemplate

logger = logging.getLogger(__name__)

# Most urgent first; also decides which counts become the digest's stat chips.
SEVERITY_ORDER = [
    'ATTENDANCE_RISK', 'FEE_OVERDUE', 'ABSENCE', 'FEE_DUE', 'LIBRARY_OVERDUE',
    'ASSIGNMENT_DUE', 'EXAM_SCHEDULE', 'EXAM_RESULT', 'LEAVE_DECISION',
    'TRANSPORT_UPDATE', 'GENERAL', 'CUSTOM',
]

# (singular, plural) used in the fallback sentence and the stat chips.
EVENT_NOUNS = {
    'ATTENDANCE_RISK': ('attendance risk alert', 'attendance risk alerts'),
    'FEE_OVERDUE': ('overdue fee', 'overdue fees'),
    'ABSENCE': ('absence alert', 'absence alerts'),
    'FEE_DUE': ('fee reminder', 'fee reminders'),
    'LIBRARY_OVERDUE': ('overdue library book', 'overdue library books'),
    'ASSIGNMENT_DUE': ('assignment due', 'assignments due'),
    'EXAM_SCHEDULE': ('exam schedule update', 'exam schedule updates'),
    'EXAM_RESULT': ('published result', 'published results'),
    'LEAVE_DECISION': ('leave update', 'leave updates'),
    'TRANSPORT_UPDATE': ('transport update', 'transport updates'),
    'GENERAL': ('announcement', 'announcements'),
    'CUSTOM': ('message', 'messages'),
}

DIGEST_WINDOW_DAYS = 7
CACHE_SECONDS = 6 * 60 * 60
MAX_STATS = 3


def _noun(event_type, count):
    singular, plural = EVENT_NOUNS.get(event_type, ('notification', 'notifications'))
    return singular if count == 1 else plural


def unread_counts(unread_qs):
    """{event_type: count} for unread in-app notifications in the digest window."""
    since = timezone.now() - timedelta(days=DIGEST_WINDOW_DAYS)
    rows = (
        unread_qs.filter(created_at__gte=since)
        .values('event_type')
        .annotate(n=Count('id'))
    )
    return {r['event_type']: r['n'] for r in rows}


def _ordered(counts):
    def key(item):
        t = item[0]
        return SEVERITY_ORDER.index(t) if t in SEVERITY_ORDER else len(SEVERITY_ORDER)
    return sorted(counts.items(), key=key)


def build_stats(counts):
    return [
        {'event_type': t, 'count': n, 'label': _noun(t, n)}
        for t, n in _ordered(counts)[:MAX_STATS]
    ]


def fallback_text(counts):
    """Deterministic sentence used when the LLM is off, slow, or errors out."""
    total = sum(counts.values())
    parts = [f"{n} {_noun(t, n)}" for t, n in _ordered(counts)[:4]]
    if not parts:
        return ''
    lead = f"You have {total} unread notification{'s' if total != 1 else ''}"
    return f"{lead}: {', '.join(parts[:-1])}{' and ' if len(parts) > 1 else ''}{parts[-1]}."


def _llm_text(counts, role):
    if not getattr(settings, 'GROQ_API_KEY', ''):
        return ''
    from groq import Groq

    lines = [f"- {n} {_noun(t, n)}" for t, n in _ordered(counts)]
    prompt = (
        "Write a 1-2 sentence daily digest for a school app user"
        f"{f' with the role {role}' if role else ''}. "
        "Use ONLY the counts below. Do not invent names, dates, amounts or causes. "
        "Plain, friendly, direct. Mention the most urgent items first. "
        "Return only the digest text.\n\nUnread notifications:\n" + "\n".join(lines)
    )
    client = Groq(api_key=settings.GROQ_API_KEY, timeout=8)
    response = client.chat.completions.create(
        model=settings.GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=400,
    )
    return (response.choices[0].message.content or '').strip()


def get_digest(user, unread_qs, school_key):
    """
    Returns {'text', 'stats', 'total', 'source'}; text is '' when nothing is unread.
    Cached per user/scope/day, keyed on the counts so a new notification
    regenerates it instead of showing a stale summary.
    """
    counts = unread_counts(unread_qs)
    total = sum(counts.values())
    if not total:
        return {'text': '', 'stats': [], 'total': 0, 'source': 'none'}

    stats = build_stats(counts)
    digest_hash = hashlib.md5(json.dumps(sorted(counts.items())).encode()).hexdigest()[:12]
    key = f"notif_digest:{user.id}:{school_key}:{timezone.localdate().isoformat()}:{digest_hash}"

    cached = cache.get(key)
    if cached:
        return {**cached, 'stats': stats, 'total': total}

    source = 'ai'
    text = ''
    try:
        text = _llm_text(counts, getattr(user, 'role', ''))
    except Exception:
        # Digest is decorative; a Groq outage must never break the dashboard.
        logger.warning('Notification digest LLM call failed', exc_info=True)
    if not text:
        text, source = fallback_text(counts), 'rules'

    payload = {'text': text, 'source': source}
    cache.set(key, payload, CACHE_SECONDS)
    return {**payload, 'stats': stats, 'total': total}
