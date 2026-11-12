"""report_missing_capability: lets the model say "no tool fits this request" so the owner can see what to build."""
from .. import gaps
from ..registry import Tool, register

CATEGORIES = ['reports', 'lists', 'messaging', 'finance', 'academics', 'attendance', 'hr', 'students', 'operations', 'other']

# The cap lives on the turn's ToolContext so a model that repeats itself writes one row, not five.
_REPORTED = '_gap_reported'


def report_missing_capability(ctx, summary='', category='other'):
    if getattr(ctx, _REPORTED, False):
        return {'recorded': False, 'note': 'Already reported this turn. Do not call again.'}
    setattr(ctx, _REPORTED, True)
    # Students and parents store only the category: record_gap drops the text for those roles.
    gaps.record_gap(ctx, 'missing_tool', summary, agent=category if category in CATEGORIES else 'other')
    return {'recorded': True}


register(Tool(
    name='report_missing_capability',
    description='Call ONCE when no available tool can do what the user asked (not for ordinary errors). '
                'Give a short paraphrase of the request WITHOUT names or phone numbers, then tell the user plainly '
                'that you cannot do it yet and suggest the screen to use.',
    parameters={'type': 'object', 'properties': {
        'summary': {'type': 'string', 'description': 'What the user wanted, in one short sentence, no names or numbers'},
        'category': {'type': 'string', 'enum': CATEGORIES},
    }, 'required': ['summary'], 'additionalProperties': False},
    handler=report_missing_capability, sub_agent='directory', module=None,
    roles=('SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL', 'MANAGER', 'TEACHER', 'STAFF', 'DRIVER', 'PARENT', 'STUDENT'),
    shared=True,
))
