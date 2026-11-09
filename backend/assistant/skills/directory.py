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


_NUMBER_WORDS = {'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5', 'six': '6', 'seven': '7',
                 'eight': '8', 'nine': '9', 'ten': '10', 'eleven': '11', 'twelve': '12',
                 'first': '1', 'second': '2', 'third': '3', 'fourth': '4', 'fifth': '5', 'sixth': '6',
                 'seventh': '7', 'eighth': '8', 'ninth': '9', 'tenth': '10', 'eleventh': '11', 'twelfth': '12'}
_FILLER = {'class', 'grade', 'std', 'standard', 'section', 'sec', 'of', 'the'}


def class_key(text):
    """One comparable form for "Class 8 B", "8B", "8-b", "eighth B", "class eight b".

    Users say a class many ways and the database stores name and section apart; both sides are
    reduced to the same form before comparing, so "5th A" finds "Class 5" section "A".
    """
    raw = _norm(text).split()
    # A school may prefix its class names ("Beaconhouse Class 5A"); what comes before the word "class"/"grade" is not part of the class.
    for i, w in enumerate(raw):
        if w in ('class', 'grade', 'std', 'standard') and i > 0 and i + 1 < len(raw):
            raw = raw[i:]
            break
    words = []
    for w in raw:
        ordinal = re.match(r'^(\d+)(?:st|nd|rd|th)$', w)
        w = ordinal.group(1) if ordinal else _NUMBER_WORDS.get(w, w)
        if w not in _FILLER:
            words.append(w)
    return ''.join(words)


def class_matches(wanted, key):
    """"5" matches 5, 5A, 5B but never 15 or 50; "5a" matches only 5A."""
    if not wanted:
        return True
    if key == wanted:
        return True
    return key.startswith(wanted) and not (wanted[-1].isdigit() and key[len(wanted)].isdigit())


def _class_label(class_obj):
    return f'{class_obj.name} {class_obj.section or ""}'.strip()


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
    # The class is applied before the cut-off. Filtering after taking the first 300 names lost the
    # right child in a large school whenever the name was common.
    wanted = class_key(class_name) if class_name else ''
    rows = []
    for st in qs.order_by('id')[:2000]:
        label = _class_label(st.class_obj) if st.class_obj_id else ''
        if wanted and not class_matches(wanted, class_key(label)):
            continue
        ratio = difflib.SequenceMatcher(None, _norm(query), _norm(st.name)).ratio()
        has_all = all(t in _norm(st.name) for t in tokens)
        rows.append((ratio + (1 if has_all else 0), {'student_id': st.id, 'name': st.name, 'class': label, 'roll_number': st.roll_number, '_all': has_all}))
    rows.sort(key=lambda r: r[0], reverse=True)
    # Partial matches ("Ali Farooq" -> every other Farooq) made the model say "several students" and ask,
    # even though exactly one person had the full name. Once anyone has every word, only they are returned.
    full_rows = [r for r in rows if r[1]['_all']]
    if full_rows:
        rows = full_rows
    matches = [r[1] for r in rows[:MAX_RESULTS]]
    no_full = bool(matches) and not any(m['_all'] for m in matches)
    for m in matches:
        m.pop('_all', None)
    note = ''
    if no_full:
        # Every candidate matched only part of the name (e.g. "Ali Raza" -> "Ali Hassan", "Hamza Raza"): they are not the person asked for.
        return {'matches': matches[:5], 'count': min(len(matches), 5),
                'note': 'NO student has all of these words in their name. These are only partial matches. Tell the user nobody has that exact name '
                        'and offer these as possible alternatives; do not act on any of them without confirmation.'}
    if class_name and not matches:
        note = 'No student with that name in that class. Try again without the class, or check the class name.'
    elif len(matches) == 1 and len(tokens) > 1:
        note = 'Exactly one student matches the full name. Use this student; do not ask the user to confirm.'
    elif len(matches) > 1:
        note = 'Several matches: ask the user which one.'
    return {'matches': matches, 'count': len(matches), 'note': note}


def find_class(ctx, query):
    from students.models import Class

    want = class_key(query)
    rows = []
    for c in Class.objects.filter(school_id=ctx.school_id, is_active=True):
        label = _class_label(c)
        flat = class_key(label)
        ratio = 1.0 if want == flat else (0.9 if want and class_matches(want, flat) else difflib.SequenceMatcher(None, want, flat).ratio())
        rows.append((ratio, {'class_id': c.id, 'name': c.name, 'section': c.section or '', 'label': label}))
    rows.sort(key=lambda r: r[0], reverse=True)
    matches = [r[1] for r in rows[:MAX_RESULTS] if r[0] >= 0.5]
    return {'matches': matches, 'count': len(matches),
            'note': 'Several matches: ask the user which one.' if len(matches) > 1 else ''}


register(Tool(
    name='find_student',
    description='Find a student by name (partial or misspelled is fine). Returns student_id and class. '
                'Use before any tool that needs a student_id. When the user names a class or section (e.g. "5A"), pass it as class_name so only '
                'that class is searched. If several still match, ask the user which one.',
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
