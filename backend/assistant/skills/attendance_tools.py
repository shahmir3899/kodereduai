"""Attendance through the assistant: who has not marked, class registers, and marking a register.

Marking goes through AttendanceRecordViewSet.bulk_entry - the manual-entry endpoint the app
uses - so its rules (class teachers mark only their own section, students who left or have not
joined are refused, absence notifications to parents) apply unchanged. The card shows the whole
register, what it replaces, and that absent students' parents will be notified.
"""
from datetime import date as date_cls

from django.utils import timezone

from ..internal_api import call
from ..registry import ADMINS, ProposalError, Tool, register
from . import lms_common as lc

READ_ROLES = ADMINS + ('MANAGER', 'TEACHER')
WRITE_ROLES = ADMINS + ('TEACHER',)
STATUSES = ['PRESENT', 'ABSENT', 'LEAVE']


# ── who may mark which section ───────────────────────────────────────────────

def _class_teacher_sections(ctx):
    """Session classes this user is class teacher of (a master-class-only assignment covers all its sections)."""
    from academic_sessions.models import SessionClass
    from academic_sessions.utils import resolve_current_academic_year_id
    from academics.models import ClassTeacherAssignment
    from django.db.models import Q

    year_id = resolve_current_academic_year_id(ctx.school_id)
    qs = ClassTeacherAssignment.objects.filter(school_id=ctx.school_id, teacher__user=ctx.user, is_active=True)
    if year_id:
        qs = qs.filter(Q(academic_year_id=year_id) | Q(academic_year__isnull=True))
    section_ids = {a.session_class_id for a in qs if a.session_class_id}
    master_ids = {a.class_obj_id for a in qs if not a.session_class_id}
    sections = SessionClass.objects.filter(school_id=ctx.school_id, academic_year_id=year_id, is_active=True)
    return [sc for sc in sections if sc.id in section_ids or sc.class_obj_id in master_ids]


def _my_section(ctx, class_name, section=None):
    """Exactly one section to work with; several candidates -> ask the user."""
    options = lc.find_sections(ctx, class_name, section)
    if ctx.role == 'TEACHER':
        mine = {sc.id for sc in _class_teacher_sections(ctx)}
        options = [sc for sc in options if sc.id in mine]
        if not options:
            raise ProposalError(f'You are not the class teacher of {class_name}'
                                f'{" " + section if section else ""}, so you cannot mark its attendance.')
    if not options:
        raise ProposalError(f'No class matching "{class_name}" in the current academic year.')
    if len(options) > 1:
        raise ProposalError(f'{class_name} has several sections ({", ".join(lc.section_label(sc) for sc in options)}). '
                            'Ask the user which section.')
    return options[0]


# ── rosters ──────────────────────────────────────────────────────────────────

def _roster(ctx, sc, day):
    """{student_id: name} of students on the section's register that day (same rules as bulk_entry)."""
    from academic_sessions.leaving import enrolled_on_q, left_by, not_yet_admitted
    from academic_sessions.placement_service import student_ids_placed_on
    from academic_sessions.roster import enrollments_in_scope
    from students.models import Student

    enrollments = enrollments_in_scope(ctx.school_id, academic_year_id=sc.academic_year_id, session_class_id=sc.id,
                                       class_obj_id=sc.class_obj_id, include_inactive=True)
    if enrollments is None:
        ids = set(Student.objects.filter(school_id=ctx.school_id, class_obj_id=sc.class_obj_id, is_active=True).values_list('id', flat=True))
    else:
        ids = set(enrollments.filter(enrolled_on_q(day)).values_list('student_id', flat=True))
        placed, has_placements = student_ids_placed_on(day, list(ids), school_id=ctx.school_id, session_class_id=sc.id,
                                                       class_obj_id=sc.class_obj_id)
        ids = {i for i in ids if i not in has_placements} | placed
    if ids:
        ids -= set(left_by(ctx.school_id, list(ids), day))
        ids -= set(not_yet_admitted(ctx.school_id, list(ids), day))
    return dict(Student.objects.filter(school_id=ctx.school_id, id__in=ids).order_by('name').values_list('id', 'name'))


def _existing(ctx, student_ids, day):
    from attendance.models import AttendanceRecord
    return dict(AttendanceRecord.objects.filter(school_id=ctx.school_id, date=day, student_id__in=list(student_ids))
                .values_list('student_id', 'status'))


def _day(value):
    d = lc.parse_date(value, 'date') if value else timezone.localdate()
    if d > timezone.localdate():
        raise ProposalError('Attendance cannot be marked for a future date.')
    return d


def _sections_for_reads(ctx):
    from academic_sessions.models import SessionClass
    from academic_sessions.utils import resolve_current_academic_year_id

    if ctx.role == 'TEACHER':
        return _class_teacher_sections(ctx)
    year_id = resolve_current_academic_year_id(ctx.school_id)
    return list(SessionClass.objects.filter(school_id=ctx.school_id, academic_year_id=year_id, is_active=True).order_by('grade_level', 'section'))


# ── reads ────────────────────────────────────────────────────────────────────

def get_unmarked_attendance(ctx, date=None):
    day = _day(date)
    from academic_sessions.calendar_rules import is_off_day_for_date

    sections = _sections_for_reads(ctx)
    if sections and is_off_day_for_date(ctx.school_id, day, class_id=sections[0].class_obj_id):
        return {'date': day, 'note': 'School is off on this date.', 'not_marked': [], 'partly_marked': []}
    not_marked, partial = [], []
    for sc in sections:
        roster = _roster(ctx, sc, day)
        if not roster:
            continue
        marked = len(_existing(ctx, roster, day))
        entry = {'class': lc.section_label(sc), 'students': len(roster), 'marked': marked}
        if marked == 0:
            not_marked.append(entry)
        elif marked < len(roster):
            partial.append(entry)
    return {'date': day, 'sections_checked': len(sections), 'not_marked': not_marked, 'partly_marked': partial,
            'all_done': not not_marked and not partial}


def get_attendance_summary_school(ctx, date=None):
    day = _day(date)
    totals = {'PRESENT': 0, 'ABSENT': 0, 'LEAVE': 0}
    enrolled = 0
    for sc in _sections_for_reads(ctx):
        roster = _roster(ctx, sc, day)
        enrolled += len(roster)
        for status in _existing(ctx, roster, day).values():
            totals[status] = totals.get(status, 0) + 1
    marked = sum(totals.values())
    return {'date': day, 'enrolled': enrolled, 'present': totals['PRESENT'], 'absent': totals['ABSENT'], 'leave': totals['LEAVE'],
            'not_marked': max(enrolled - marked, 0), 'marked_percent': round(100 * marked / enrolled, 1) if enrolled else None}


def get_class_attendance(ctx, class_name=None, section=None, date=None):
    if not class_name:
        raise ProposalError('Which class? Ask the user.')
    day = _day(date)
    sc = _my_section(ctx, class_name, section)
    roster = _roster(ctx, sc, day)
    existing = _existing(ctx, roster, day)
    rows = [{'student_id': sid, 'name': name, 'status': existing.get(sid, 'NOT MARKED')} for sid, name in roster.items()]
    counts = {k: sum(1 for r in rows if r['status'] == k) for k in STATUSES + ['NOT MARKED']}
    return {'class': lc.section_label(sc), 'date': day, 'students': len(rows), 'counts': counts,
            'absent': [r['name'] for r in rows if r['status'] == 'ABSENT'],
            'on_leave': [r['name'] for r in rows if r['status'] == 'LEAVE'], 'register': rows[:80]}


# ── marking ──────────────────────────────────────────────────────────────────

def _build(ctx, payload):
    from academic_sessions.models import SessionClass

    sc = SessionClass.objects.filter(school_id=ctx.school_id, id=payload['section'], is_active=True).first()
    if sc is None:
        raise ProposalError('That class section no longer exists.')
    day = _day(payload['date'])
    roster = _roster(ctx, sc, day)
    if not roster:
        raise ProposalError(f'{lc.section_label(sc)} has no students on its register for {day}.')
    existing = _existing(ctx, roster, day)

    entries, warnings, rows = [], [], []
    for e in payload['entries']:
        sid = e['student_id']
        if sid not in roster:
            warnings.append(f'Student {sid} is not on the register for {day} and was removed.')
            continue
        entries.append({'student_id': sid, 'status': e['status'], 'was': existing.get(sid, 'NOT MARKED')})
        rows.append({'student_id': sid, 'student': roster[sid], 'was': existing.get(sid, 'NOT MARKED'), 'status': e['status'],
                     'changed': existing.get(sid) != e['status']})
    if not entries:
        raise ProposalError('Nothing to save.')
    counts = {k: sum(1 for r in rows if r['status'] == k) for k in STATUSES}
    replaced = sum(1 for r in rows if r['was'] != 'NOT MARKED' and r['changed'])
    unmarked = len(roster) - len(entries)
    if replaced:
        warnings.append(f'{replaced} existing mark(s) will be replaced.')
    if counts['ABSENT']:
        warnings.append(f'Parents of {counts["ABSENT"]} absent student(s) will be notified.')
    if unmarked:
        warnings.append(f'{unmarked} student(s) are left untouched.')
    from academic_sessions.calendar_rules import is_off_day_for_date
    if is_off_day_for_date(ctx.school_id, day, class_id=sc.class_obj_id):
        warnings.append('The school calendar marks this day as off.')

    new_payload = {**payload, 'entries': [{'student_id': e['student_id'], 'status': e['status'], 'was': e['was']} for e in entries]}
    return {'payload': new_payload, 'preview': {
        'kind': 'attendance', 'title': 'Mark attendance',
        'summary': f'{lc.section_label(sc)} on {day}: {counts["PRESENT"]} present, {counts["ABSENT"]} absent, {counts["LEAVE"]} on leave',
        'columns': ['Student', 'Now', 'Will be'], 'rows': rows, 'totals': {'count': len(rows), **{k.lower(): v for k, v in counts.items()}},
        'warnings': warnings, 'assumptions': {'class': lc.section_label(sc), 'date': day.isoformat()},
        'editable': {'statuses': STATUSES, 'date': True},
    }}


def mark_attendance(ctx, class_name=None, section=None, date=None, absent_names=None, leave_names=None, present_names=None,
                    absent_student_ids=None, leave_student_ids=None, present_student_ids=None, rest='PRESENT'):
    if not class_name:
        raise ProposalError('Which class? Ask the user.')
    sc = _my_section(ctx, class_name, section)
    day = _day(date)
    roster = _roster(ctx, sc, day)
    if not roster:
        raise ProposalError(f'{lc.section_label(sc)} has no students on its register for {day}.')
    groups = {
        'ABSENT': lc.match_names(roster, absent_names, absent_student_ids, ' to mark absent'),
        'LEAVE': lc.match_names(roster, leave_names, leave_student_ids, ' to mark on leave'),
        'PRESENT': lc.match_names(roster, present_names, present_student_ids, ' to mark present'),
    }
    seen = {}
    for status, ids in groups.items():
        for sid in ids:
            if sid in seen:
                raise ProposalError(f'{roster[sid]} is in both the {seen[sid].lower()} and {status.lower()} lists. Ask the user which is right.')
            seen[sid] = status
    entries = [{'student_id': sid, 'status': seen[sid]} for sid in roster if sid in seen]
    if rest == 'PRESENT':
        entries = [{'student_id': sid, 'status': seen.get(sid, 'PRESENT')} for sid in roster]
    elif not entries:
        raise ProposalError('Say which students to mark. Ask the user.')
    existing = _existing(ctx, roster, day)
    entries = [{**e, 'was': existing.get(e['student_id'], 'NOT MARKED')} for e in entries]
    return _build(ctx, {'kind': 'attendance', 'section': sc.id, 'class_obj': sc.class_obj_id, 'date': day.isoformat(),
                        'entries': entries})


def revise_attendance(ctx, payload, edits):
    payload = {**payload, 'entries': [dict(e) for e in payload['entries']]}
    by_id = {e['student_id']: e for e in payload['entries']}
    for sid, status in (edits.get('statuses') or {}).items():
        if int(sid) not in by_id:
            raise ProposalError(f'Student {sid} is not on this card.')
        if status not in STATUSES:
            raise ProposalError(f'Status must be one of {", ".join(STATUSES)}.')
        by_id[int(sid)]['status'] = status
    if edits.get('date'):
        payload['date'] = _day(edits['date']).isoformat()
        existing = _existing(ctx, by_id, date_cls.fromisoformat(payload['date']))
        for e in payload['entries']:
            e['was'] = existing.get(e['student_id'], 'NOT MARKED')
    return _build(ctx, payload)


def apply_attendance(ctx, payload):
    from attendance.views import AttendanceRecordViewSet

    data = {'session_class_id': payload['section'], 'date': payload['date'],
            'entries': [{'student_id': e['student_id'], 'status': e['status']} for e in payload['entries']]}
    status, body = call(ctx.user, ctx.school_id, AttendanceRecordViewSet, {'post': 'bulk_entry'}, 'post',
                        '/api/attendance/records/bulk_entry/', data)
    if status != 200:
        return {'ok': False, 'error': str((body or {}).get('detail') or body)[:300]}
    saved = body.get('created', 0) + body.get('updated', 0)
    return {'ok': saved > 0, 'saved': saved, 'created': body.get('created', 0), 'updated': body.get('updated', 0),
            'errors': body.get('errors', []), **({} if saved else {'error': 'No attendance could be saved: ' + str(body.get('errors'))[:200]})}


_O = {'additionalProperties': False}
_DATE = {'type': 'string', 'description': 'YYYY-MM-DD, defaults to today'}

register(Tool(
    name='get_unmarked_attendance',
    description='Which classes have NOT marked attendance on a date (and which are only partly marked). Teachers see only their own classes.',
    parameters={'type': 'object', **_O, 'properties': {'date': _DATE}},
    handler=get_unmarked_attendance, sub_agent='attendance', module='attendance', roles=READ_ROLES,
))
register(Tool(
    name='get_attendance_summary_school',
    description='School-wide attendance for a date: enrolled, present, absent, on leave, not yet marked.',
    parameters={'type': 'object', **_O, 'properties': {'date': _DATE}},
    handler=get_attendance_summary_school, sub_agent='attendance', module='attendance', roles=ADMINS + ('MANAGER',),
))
register(Tool(
    name='get_class_attendance',
    description="One class section's register for a date: who is absent / on leave and the counts.",
    parameters={'type': 'object', **_O, 'properties': {'class_name': {'type': 'string'}, 'section': {'type': 'string'}, 'date': _DATE}},
    handler=get_class_attendance, sub_agent='attendance', module='attendance', roles=READ_ROLES,
))
register(Tool(
    name='mark_attendance',
    description=(
        'PREPARE a class register for review ("class 5A ki hazri lagao, Ali aur Sara ghair hazir hain"): named students get the status '
        'given, everyone else is PRESENT (rest="PRESENT") or left alone (rest="UNCHANGED", for corrections like "Ali ko present kar do"). '
        'One section at a time; if the class has several sections, ask which. If a name matches several students, ask which. '
        'Nothing is saved until the user presses Approve. Marking absent notifies parents.'),
    parameters={'type': 'object', **_O, 'properties': {
        'class_name': {'type': 'string'}, 'section': {'type': 'string', 'description': 'Section letter, e.g. "A"'}, 'date': _DATE,
        'absent_names': {'type': 'array', 'items': {'type': 'string'}}, 'leave_names': {'type': 'array', 'items': {'type': 'string'}},
        'present_names': {'type': 'array', 'items': {'type': 'string'}},
        'absent_student_ids': {'type': 'array', 'items': {'type': 'integer'}}, 'leave_student_ids': {'type': 'array', 'items': {'type': 'integer'}},
        'present_student_ids': {'type': 'array', 'items': {'type': 'integer'}},
        'rest': {'type': 'string', 'enum': ['PRESENT', 'UNCHANGED']}}},
    handler=mark_attendance, sub_agent='attendance', module='attendance', roles=WRITE_ROLES, kind='write',
    revise=revise_attendance, apply=apply_attendance,
))
