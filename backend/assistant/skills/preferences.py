"""Aura remembers how a person works (backlog item D): reply language, usual class, usual fee account.

Reading is open to everyone who can chat. Changing goes through a preview card like every other write, so a stray
instruction inside a tool result can never silently change someone's settings; parents and students (no write tools by
rule) change theirs in the settings sheet instead."""
from .. import prefs
from ..registry import ProposalError, Tool, register

WRITE_ROLES = ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL', 'MANAGER', 'ACCOUNTANT', 'TEACHER', 'STAFF', 'DRIVER')
ALL_ROLES = WRITE_ROLES + ('PARENT', 'STUDENT')
LABELS = {'language': 'Reply language', 'default_class': 'Usual class', 'default_account_id': 'Usual fee account'}


def get_my_preferences(ctx):
    return {'preferences': prefs.get(ctx.school_id, ctx.user.id), 'languages': list(prefs.LANGUAGES)}


def _build(ctx, payload):
    changes = payload.get('changes') or {}
    if not changes:
        raise ProposalError('Nothing to save. Ask which preference: language (auto / en / ur / roman), usual class, or usual fee account.')
    clean = prefs.validate(ctx, changes)
    current = prefs.get(ctx.school_id, ctx.user.id)
    rows = [{'field': LABELS[k], 'value': ('(cleared)' if v is None else str(v)) + (f'   (was {current[k]})' if k in current else '')}
            for k, v in clean.items()]
    return {'payload': {'kind': 'preferences', 'changes': clean}, 'preview': {
        'kind': 'preferences', 'title': 'Save my preferences', 'summary': ', '.join(LABELS[k] for k in clean),
        'columns': ['Field', 'Value'], 'rows': rows, 'totals': {'count': len(rows)}, 'warnings': [], 'editable': {}}}


def set_my_preferences(ctx, language=None, default_class=None, default_account_id=None, clear=None):
    changes = {k: v for k, v in (('language', language), ('default_class', default_class), ('default_account_id', default_account_id)) if v not in (None, '')}
    for key in clear or []:
        if key not in prefs.KEYS:
            raise ProposalError('Cannot clear "' + str(key) + '". Allowed: ' + ', '.join(prefs.KEYS))
        changes[key] = None
    return _build(ctx, {'changes': changes})


def revise_prefs(ctx, payload, edits):
    return _build(ctx, payload)


def apply_prefs(ctx, payload):
    return {'ok': True, 'preferences': prefs.save(ctx, payload['changes'])}


register(Tool(
    name='get_my_preferences',
    description='The signed-in user\'s saved preferences: reply language, usual class, usual fee account.',
    parameters={'type': 'object', 'properties': {}, 'additionalProperties': False},
    handler=get_my_preferences, sub_agent='settings', module=None, roles=ALL_ROLES,
))
register(Tool(
    name='set_my_preferences',
    description='PREPARE saving the user\'s own preferences ("always reply in Urdu", "my class is 5A", "use Cash account for fees"). '
                'Only for what the user asks to remember. Nothing is saved until they approve.',
    parameters={'type': 'object', 'properties': {
        'language': {'type': 'string', 'enum': list(prefs.LANGUAGES)},
        'default_class': {'type': 'string', 'description': 'e.g. "5A" or "Class 5"'},
        'default_account_id': {'type': 'integer', 'description': 'Fee account id (from the finance tools)'},
        'clear': {'type': 'array', 'items': {'type': 'string', 'enum': list(prefs.KEYS)}, 'description': 'Preferences to forget'},
    }, 'additionalProperties': False},
    handler=set_my_preferences, sub_agent='settings', module=None, roles=WRITE_ROLES, kind='write',
    revise=revise_prefs, apply=apply_prefs,
))
