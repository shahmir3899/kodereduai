"""Lookup helpers: turn a spoken name into the record the other tools need.

The old Communication agent expected the model to already know numeric student and class
ids. `find_student` / `find_class` are shared tools: they ride along with whichever
sub-agent the router picks. They return several candidates so the model can ask "which one?"
instead of guessing (two Ahmads in one class is normal).
"""
import difflib
import re

from ..registry import ADMINS, Tool, register

LOOKUP_ROLES = ADMINS + ('MANAGER', 'ACCOUNTANT')
MAX_RESULTS = 8


def _norm(text):
    return re.sub(r'[^a-z0-9 ]+', ' ', (text or '').lower()).strip()


def find_student(ctx, query, class_name=None):
    from django.db.models import Q

    from students.models import Student

    tokens = [t for t in _norm(query).split() if len(t) > 1]
    if not tokens:
        return {'matches': [], 'note': 'Give at least part of the student name.'}
    cond = Q()
    for t in tokens:
        cond |= Q(name__icontains=t)
    qs = Student.objects.filter(school_id=ctx.school_id, is_active=True).filter(cond).select_related('class_obj')
    rows = []
    for st in qs[:300]:
        label = f'{st.class_obj.name} {st.class_obj.section or ""}'.strip() if st.class_obj_id else ''
        if class_name and _norm(class_name).replace(' ', '') not in _norm(label).replace(' ', ''):
            continue
        ratio = difflib.SequenceMatcher(None, _norm(query), _norm(st.name)).ratio()
        rows.append((ratio, {'student_id': st.id, 'name': st.name, 'class': label, 'roll_number': st.roll_number}))
    rows.sort(key=lambda r: r[0], reverse=True)
    matches = [r[1] for r in rows[:MAX_RESULTS]]
    return {'matches': matches, 'count': len(matches),
            'note': 'Several matches: ask the user which one.' if len(matches) > 1 else ''}


def find_class(ctx, query):
    from students.models import Class

    want = _norm(query).replace(' ', '')
    rows = []
    for c in Class.objects.filter(school_id=ctx.school_id, is_active=True):
        label = f'{c.name} {c.section or ""}'.strip()
        flat = _norm(label).replace(' ', '')
        ratio = 1.0 if want == flat else (0.9 if want and want in flat else difflib.SequenceMatcher(None, want, flat).ratio())
        rows.append((ratio, {'class_id': c.id, 'name': c.name, 'section': c.section or '', 'label': label}))
    rows.sort(key=lambda r: r[0], reverse=True)
    matches = [r[1] for r in rows[:MAX_RESULTS] if r[0] >= 0.5]
    return {'matches': matches, 'count': len(matches),
            'note': 'Several matches: ask the user which one.' if len(matches) > 1 else ''}


register(Tool(
    name='find_student',
    description='Find a student by name (partial or misspelled is fine). Returns student_id and class. '
                'Use before any tool that needs a student_id. If several match, ask the user which one.',
    parameters={'type': 'object', 'properties': {
        'query': {'type': 'string', 'description': 'Student name as the user said it'},
        'class_name': {'type': 'string', 'description': 'Optional class to narrow down, e.g. "8B"'},
    }, 'required': ['query'], 'additionalProperties': False},
    handler=find_student, sub_agent='directory', module='students', roles=LOOKUP_ROLES, shared=True,
))
register(Tool(
    name='find_class',
    description='Find a class/section by name, e.g. "8B" or "class 5". Returns class_id. '
                'Use before any tool that needs a class_id.',
    parameters={'type': 'object', 'properties': {
        'query': {'type': 'string'},
    }, 'required': ['query'], 'additionalProperties': False},
    handler=find_class, sub_agent='directory', module='students', roles=LOOKUP_ROLES, shared=True,
))
