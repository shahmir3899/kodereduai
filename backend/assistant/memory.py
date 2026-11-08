"""Conversation memory: last-10-message window, rolling summary, durable state."""
import logging

from . import llm

logger = logging.getLogger(__name__)

WINDOW = 10            # messages the agent sees verbatim; the UI shows it as N/10
SUMMARY_BATCH = 4      # fold overflow into the summary only once this many have piled up


def window_messages(conversation):
    """Last WINDOW messages, oldest first."""
    rows = list(conversation.messages.order_by('-created_at', '-id')[:WINDOW])
    rows.reverse()
    return rows


def counter(conversation):
    """What the chat header shows: how many messages the agent currently remembers."""
    total = conversation.messages.count()
    return {'used': min(total, WINDOW), 'limit': WINDOW}


def maybe_summarize(conversation):
    """Fold messages that fell out of the window into `conversation.summary`.
    Failure is non-fatal: the window still works, only older context is lost."""
    total = conversation.messages.count()
    overflow_end = total - WINDOW
    if overflow_end - conversation.summarized_count < SUMMARY_BATCH:
        return
    batch = list(
        conversation.messages.order_by('created_at', 'id')[conversation.summarized_count:overflow_end]
    )
    transcript = '\n'.join(f'{m.role}: {m.content[:600]}' for m in batch)
    prompt = [
        {'role': 'system', 'content': (
            'Update the running summary of a school-assistant conversation. Keep names, '
            'numbers, class/teacher/book choices and unfinished requests. Max 120 words. '
            'Reply with the new summary only.')},
        {'role': 'user', 'content': f'Current summary:\n{conversation.summary or "(none)"}\n\nNew messages:\n{transcript}'},
    ]
    try:
        reply = llm.complete(prompt, max_tokens=300, temperature=0.2, tier='fast')
    except Exception:
        logger.warning('assistant summary skipped', exc_info=True)
        return
    if reply.content:
        conversation.summary = reply.content
        conversation.summarized_count = overflow_end
        conversation.save(update_fields=['summary', 'summarized_count', 'last_active'])


def merge_state(conversation, updates: dict):
    state = dict(conversation.state or {})
    state.update(updates)
    conversation.state = state
    conversation.save(update_fields=['state', 'last_active'])
