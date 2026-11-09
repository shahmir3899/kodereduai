"""The one place that writes AgentGap rows.

Capture must never break an answer, so every entry point swallows and logs its own errors.
Students and parents are often minors: for them only the category is stored, and the raw text is
not even passed to redaction.
"""
import logging
from datetime import timedelta

from django.utils import timezone

from . import redact
from .models import AgentGap

logger = logging.getLogger(__name__)

RETENTION = timedelta(days=90)
NO_TEXT_ROLES = ('STUDENT', 'PARENT')

# Text that means "Aura declined / has no tool". Kept short on purpose; the weekly grouping and the
# owner's review absorb the noise. English and Roman Urdu.
DECLINE_PHRASES = (
    "i can't", 'i cannot', "i'm unable", 'i am unable', 'no tool', "don't have a tool", 'do not have a tool',
    'not able to do', 'not available from chat', 'nahi kar sakta', 'nahi kar sakti', 'nahi kar sakte',
    'mere paas koi tool nahi', 'is ka tool nahi',
)


def looks_like_decline(text: str) -> bool:
    low = (text or '').lower().replace('’', "'")
    return any(p in low for p in DECLINE_PHRASES)


def record_gap(ctx, kind, text='', *, agent='', tool_hint='', message_id=None, rating=None, reason='',
               dedupe=True):
    """Save one gap. `text` is the raw text to summarise: it is redacted here (staff roles) or dropped
    (students and parents). Returns the row, or None when skipped or on any error."""
    try:
        role = ctx.role or ''
        keep_text = role not in NO_TEXT_ROLES
        summary = redact.redact(text, ctx.school_id) if keep_text and text else ''
        reason_clean = redact.redact(reason, ctx.school_id) if keep_text and reason else ''
        language = redact.detect_language(text) if keep_text and text else ''
        conv_id = getattr(ctx.conversation, 'pk', None)

        if dedupe:
            since = timezone.now() - timedelta(days=1)
            if AgentGap.objects.filter(
                school_id=ctx.school_id, user=ctx.user, kind=kind, summary=summary, tool_hint=tool_hint[:80],
                conversation_id=conv_id, message_id=message_id, created_at__gte=since,
            ).exists():
                return None

        return AgentGap.objects.create(
            school_id=ctx.school_id, user=ctx.user, role=role, agent=agent[:40], kind=kind, language=language,
            summary=summary, tool_hint=tool_hint[:80], conversation_id=conv_id, message_id=message_id,
            rating=rating, reason=reason_clean, delete_after=timezone.now() + RETENTION,
        )
    except Exception:
        logger.exception('assistant gap capture failed')
        return None
