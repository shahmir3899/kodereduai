"""Long-term preferences (backlog item D): reply language, default class, default fee account.

Read and written only for the signed-in user in the active school. An explicit instruction in a message always wins
over a stored preference; a preference only fills in what the user left out."""
import logging

from django.db import DatabaseError, transaction

from .models import AgentPreference
from .registry import ProposalError

logger = logging.getLogger(__name__)
LANGUAGES = {'auto': 'the same language the user writes in', 'en': 'English', 'ur': 'Urdu (Urdu script)', 'roman': 'Roman Urdu (Urdu in Latin letters)'}
KEYS = ('language', 'default_class', 'default_account_id')


def get(school_id, user_id) -> dict:
    # Best effort, like usage counting: a missing table (migration not applied yet) or a database hiccup must never turn an answer into an
    # error. The savepoint keeps a failed query from poisoning an enclosing transaction.
    try:
        with transaction.atomic():
            row = AgentPreference.objects.filter(school_id=school_id, user_id=user_id).first()
    except DatabaseError:
        logger.warning('assistant preferences unavailable', exc_info=True)
        return {}
    data = row.data if row and isinstance(row.data, dict) else {}
    return {k: data[k] for k in KEYS if data.get(k) not in (None, '')}


def _check_class(ctx, label):
    from .skills import lms_common as lc

    sections = lc.find_sections(ctx, label)          # raises a clear ProposalError for orphan sections
    if not sections:
        raise ProposalError(f'No class matching "{label}" in the current academic year.')
    return str(label).strip()[:40]


def _check_account(ctx, account_id):
    from .skills.finance_writes import _accounts

    accounts = _accounts(ctx)
    hit = next((a for a in accounts if a['id'] == int(account_id)), None)
    if not hit:
        raise ProposalError('That account does not exist. Accounts: ' + ', '.join(f"{a['name']} (id {a['id']})" for a in accounts))
    return hit['id']


def validate(ctx, changes: dict) -> dict:
    """Clean values for the keys given. None or '' clears a key. Unknown keys are refused, not ignored."""
    unknown = set(changes) - set(KEYS)
    if unknown:
        raise ProposalError('Unknown preference: ' + ', '.join(sorted(unknown)) + '. Allowed: ' + ', '.join(KEYS))
    clean = {}
    for key, value in changes.items():
        if value in (None, ''):
            clean[key] = None
        elif key == 'language':
            if value not in LANGUAGES:
                raise ProposalError('language must be one of: ' + ', '.join(LANGUAGES))
            clean[key] = value
        elif key == 'default_class':
            clean[key] = _check_class(ctx, value)
        else:
            clean[key] = _check_account(ctx, value)
    return clean


def save(ctx, changes: dict) -> dict:
    clean = validate(ctx, changes)
    row, _ = AgentPreference.objects.get_or_create(school_id=ctx.school_id, user=ctx.user, defaults={'data': {}})
    data = dict(row.data or {})
    for key, value in clean.items():
        if value is None:
            data.pop(key, None)
        else:
            data[key] = value
    row.data = data
    row.save(update_fields=['data', 'updated_at'])
    return get(ctx.school_id, ctx.user.id)


def prompt_block(school_id, user_id) -> str:
    p = get(school_id, user_id)
    lines = []
    if p.get('language', 'auto') != 'auto':
        lines.append(f"- Reply in {LANGUAGES[p['language']]} unless the user clearly asks for another language in this message.")
    if p.get('default_class'):
        lines.append(f"- The user's usual class is {p['default_class']}: use it when they do not name a class.")
    return ('\nSaved preferences:\n' + '\n'.join(lines) + '\n') if lines else ''
