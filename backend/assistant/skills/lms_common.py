"""Shared lookups and the scheduling maths for the lesson-plan and diary tools.

Names, classes, subjects and books are resolved here by CODE, never guessed by the model.
Anything ambiguous raises ProposalError with the candidates, which the model must turn into
a question to the user ("which Ahmad?", "4A or 4B?", "which English book?").
"""
import difflib
import re
from datetime import date, timedelta

from core.class_scope import scope_for_session_class

from ..registry import ProposalError

HONORIFICS = {'miss', 'sir', 'mr', 'mrs', 'ms', 'madam', 'maam', 'mam', 'teacher', 'ustad', 'ustaani', 'baji'}
MAX_SPAN_DAYS = 62


def tokens(text, drop_honorifics=False):
    words = re.sub(r'[^a-z0-9 ]+', ' ', (text or '').lower()).split()
    return [w for w in words if not (drop_honorifics and w in HONORIFICS)]


def flat(text):
    return ''.join(tokens(text))


def parse_date(value, what='date'):
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise ProposalError(f'{what} must look like 2026-12-01.')


# ── people ────────────────────────────────────────────────────────────────────

def staff_name(staff):
    return f'{staff.first_name} {staff.last_name}'.strip()


def find_staff(ctx, query):
    """Staff of this school matching a spoken name; best matches first."""
    from hr.models import StaffMember

    want = tokens(query, drop_honorifics=True)
    if not want:
        return []
    pool = list(StaffMember.objects.filter(school_id=ctx.school_id, is_active=True))
    exact = [s for s in pool if all(w in tokens(staff_name(s)) or any(t.startswith(w) for t in tokens(staff_name(s))) for w in want)]
    if exact:
        return exact
    return [s for s in pool if any(difflib.SequenceMatcher(None, w, t).ratio() >= 0.78
                                   for w in want for t in tokens(staff_name(s)))]


def resolve_teacher(ctx, teacher_name=None, teacher_id=None):
    """The teacher the work is for. A teacher always means themselves."""
    from hr.models import StaffMember

    if ctx.role == 'TEACHER':
        own = getattr(ctx.user, 'staff_profile', None)
        if own is None or own.school_id != ctx.school_id:
            raise ProposalError('Your account is not linked to a staff record, so lesson plans cannot be saved for you.')
        if teacher_id and int(teacher_id) != own.id:
            raise ProposalError('You can only work with your own lesson plans.')
        if teacher_name:      # naming yourself is fine ("Miss Ali" when you are Ali); naming someone else is not
            mine = tokens(staff_name(own))
            want = tokens(teacher_name, drop_honorifics=True)
            if want and not all(any(t.startswith(w) or difflib.SequenceMatcher(None, w, t).ratio() >= 0.78 for t in mine) for w in want):
                raise ProposalError('You can only work with your own lesson plans.')
        return own
    if teacher_id:
        staff = StaffMember.objects.filter(school_id=ctx.school_id, id=teacher_id).first()
        if staff:
            return staff
        raise ProposalError(f'No teacher with id {teacher_id} in this school.')
    if not teacher_name:
        raise ProposalError('Which teacher is this for? Ask the user.')
    hits = find_staff(ctx, teacher_name)
    if not hits:
        raise ProposalError(f'No teacher matching "{teacher_name}".')
    if len(hits) > 1:
        options = '; '.join(f'{staff_name(s)} (teacher_id {s.id})' for s in hits[:8])
        raise ProposalError(f'"{teacher_name}" matches {len(hits)} teachers: {options}. Ask the user which one.')
    return hits[0]


# ── classes, subjects, books ─────────────────────────────────────────────────

def section_label(sc):
    return f'{sc.display_name} {sc.section}'.strip()


def find_sections(ctx, class_name, section=None):
    """Current-year sections matching what a person says.

    A class and a section are two things: "Class 5" is the class (all its sections), "5A" / "5-A" / "Class 5 section A" /
    "fifth A" is one section. Matching uses the same normaliser as the student and class lookups (directory.class_key), so
    number words, ordinals, "section", "grade" and a school's own prefix ("Beaconhouse Class 5") are all understood."""
    from academic_sessions.models import SessionClass
    from academic_sessions.utils import resolve_current_academic_year_id

    from .directory import class_key

    year_id = resolve_current_academic_year_id(ctx.school_id)
    qs = SessionClass.objects.filter(school_id=ctx.school_id, academic_year_id=year_id, is_active=True)
    want_key, want = class_key(class_name), flat(class_name)
    if not want_key and not want:
        # A saved "usual class" fills in only what the user left out; naming a class always wins.
        from .. import prefs
        usual = prefs.get(ctx.school_id, ctx.user.id).get('default_class') if getattr(ctx, 'user', None) else None
        if not usual:
            raise ProposalError('Which class? Ask the user.')
        class_name = usual
        want_key, want = class_key(usual), flat(usual)
    out = []
    for sc in qs.select_related('class_obj'):
        ntoks = tokens(sc.display_name)
        short = ''.join(ntoks[-1:]) + sc.section.lower()          # "Class 4" + "A" -> "4a"
        master_key = class_key(sc.display_name)                   # "Class 5" -> "5"; a name that already holds the letter ("1A") stays "1a"
        full_key = master_key + sc.section.lower()
        if (want_key and want_key in (master_key, full_key)) or want in (flat(sc.display_name), flat(section_label(sc)), short) or (want.isdigit() and ntoks[-1:] == [want]):
            out.append(sc)
    if section:
        out = [sc for sc in out if sc.section.lower() == str(section).strip().lower()]
    # Same validity rule as the views (core.class_scope). An orphan section has no master class, so exams, fees and
    # books cannot be tied to it; dropping it quietly would show a half-empty class, so say so instead.
    for sc in out:
        scope = scope_for_session_class(ctx.school_id, sc.id)
        if scope['invalid']:
            raise ProposalError(f'{section_label(sc)} is not linked to a master class, so it cannot be used here. '
                                'Tell the user an admin must link it first (Classes page).')
    return out


def find_subject(ctx, name):
    from academics.models import Subject

    want = tokens(name)
    if not want:
        raise ProposalError('Which subject? Ask the user.')
    pool = list(Subject.objects.filter(school_id=ctx.school_id, is_active=True))
    hits = [s for s in pool if all(w in tokens(s.name) or w == s.code.lower() for w in want)]
    if not hits:
        hits = [s for s in pool if any(difflib.SequenceMatcher(None, w, t).ratio() >= 0.8 for w in want for t in tokens(s.name))]
    if not hits:
        raise ProposalError(f'No subject matching "{name}". Subjects: ' + ', '.join(sorted(s.name for s in pool)[:30]))
    if len(hits) > 1:
        raise ProposalError(f'"{name}" matches several subjects: ' + ', '.join(f'{s.name} (id {s.id})' for s in hits[:8]) + '. Ask the user which one.')
    return hits[0]


def teaching_assignment(ctx, section, subject):
    """ClassSubject linking a section, subject and its assigned teacher (or None)."""
    from academics.models import ClassSubject

    return ClassSubject.objects.filter(
        school_id=ctx.school_id, session_class=section, subject=subject, is_active=True,
    ).select_related('teacher').first()


def resolve_sections_for_work(ctx, class_name, subject, section=None, sections=None, all_sections=False, teacher=None):
    """The sections to plan for, plus who teaches each. A teacher is limited to sections where
    they are the assigned subject teacher. Several candidates and no instruction -> ask."""
    candidates = find_sections(ctx, class_name)
    if not candidates:
        raise ProposalError(f'No class matching "{class_name}" in the current academic year.')
    if section:
        sections = [section]
    if sections:
        wanted = {str(s).strip().lower() for s in sections}
        candidates = [sc for sc in candidates if sc.section.lower() in wanted]
        if not candidates:
            raise ProposalError(f'Class "{class_name}" has no section {", ".join(sorted(wanted))}.')

    rows = []
    for sc in candidates:
        ca = teaching_assignment(ctx, sc, subject)
        if ctx.role == 'TEACHER':
            if ca is None or ca.teacher_id != teacher.id:
                continue
            rows.append((sc, teacher))
        else:
            who = teacher or (ca.teacher if ca and ca.teacher_id else None)
            if who is None:
                continue
            if teacher and ca and ca.teacher_id and ca.teacher_id != teacher.id:
                continue
            rows.append((sc, who))
    if not rows:
        who = 'you' if ctx.role == 'TEACHER' else (staff_name(teacher) if teacher else 'a teacher')
        raise ProposalError(f'{subject.name} is not assigned to {who} in {class_name}. '
                            'Check the class, subject or teacher with the user.')
    if len(rows) > 1 and not (sections or all_sections):
        options = ', '.join(section_label(sc) for sc, _ in rows)
        raise ProposalError(f'{class_name} has several sections for {subject.name} ({options}). '
                            'Ask the user which section, or whether it is for all of them.')
    return rows


def find_books(ctx, section, subject, book_id=None):
    from lms.models import Book

    qs = Book.objects.filter(school_id=ctx.school_id, class_obj_id=section.class_obj_id, subject=subject, is_active=True)
    if book_id:
        qs = qs.filter(id=book_id)
    return list(qs)


# ── dates and allocation ─────────────────────────────────────────────────────

def working_days(school_id, class_obj_id, d0, d1, skip_saturday=False):
    from academic_sessions.calendar_rules import is_off_day_for_date

    if d1 < d0:
        raise ProposalError('The end date is before the start date.')
    if (d1 - d0).days + 1 > MAX_SPAN_DAYS:
        raise ProposalError(f'Please plan at most {MAX_SPAN_DAYS} days at a time.')
    days, cursor = [], d0
    while cursor <= d1:
        if not (skip_saturday and cursor.weekday() == 5) and not is_off_day_for_date(school_id, cursor, class_id=class_obj_id):
            days.append(cursor)
        cursor += timedelta(days=1)
    return days


def distribute(n_units, n_days):
    """For each day, the list of unit indexes taught that day, in order, using the whole range.

    fewer units than days: every unit gets a block of consecutive days (2 chapters / 8 days = 4 + 4;
                           3 / 8 = 3 + 3 + 2, extra days go to the earlier units).
    more units than days:  every day takes a consecutive slice of units (earlier days take the extra)."""
    if n_units <= 0 or n_days <= 0:
        return []
    out = []
    if n_units <= n_days:
        base, extra = divmod(n_days, n_units)
        for i in range(n_units):
            out += [[i]] * (base + (1 if i < extra else 0))
    else:
        base, extra = divmod(n_units, n_days)
        cursor = 0
        for d in range(n_days):
            size = base + (1 if d < extra else 0)
            out.append(list(range(cursor, cursor + size)))
            cursor += size
    return out


def distribute_weighted(weights, n_days):
    """Like `distribute` for fewer units than days, but longer units get more days (pages)."""
    n = len(weights)
    if n > n_days or sum(weights) <= 0:
        return distribute(n, n_days)
    spare = n_days - n
    total = float(sum(weights))
    exact = [spare * w / total for w in weights]
    alloc = [1 + int(x) for x in exact]
    order = sorted(range(n), key=lambda i: exact[i] - int(exact[i]), reverse=True)
    for i in order[:n_days - sum(alloc)]:
        alloc[i] += 1
    out = []
    for i, k in enumerate(alloc):
        out += [[i]] * k
    return out


# ── names inside a known list ────────────────────────────────────────────────

def match_names(people, names=None, ids=None, what=''):
    """Ids selected from `people` ({id: full name}) by spoken names and/or explicit ids.
    Unknown or ambiguous names raise, so the model asks instead of guessing which Ahmad."""
    chosen = set()
    for pid in ids or []:
        if int(pid) not in people:
            raise ProposalError(f'Student id {pid} is not in this class list.')
        chosen.add(int(pid))
    for name in names or []:
        want = tokens(name, drop_honorifics=True)
        if not want:
            continue
        hits = [pid for pid, full in people.items() if all(w in tokens(full) for w in want)]
        if not hits:      # spelling variants: Ahmad / Ahmed
            hits = [pid for pid, full in people.items()
                    if any(difflib.SequenceMatcher(None, w, t).ratio() >= 0.78 for w in want for t in tokens(full))]
        if not hits:
            raise ProposalError(f'No student matching "{name}" in this class. Students: '
                                + ', '.join(sorted(people.values())[:45]))
        if len(hits) > 1:
            options = '; '.join(f'{people[h]} (student_id {h})' for h in hits[:8])
            raise ProposalError(f'"{name}" matches {len(hits)} students{what}: {options}. '
                                'Ask the user which one, then pass student ids.')
        chosen.add(hits[0])
    return chosen
