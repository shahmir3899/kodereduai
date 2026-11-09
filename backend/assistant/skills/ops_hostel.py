"""Hostel through Aura (Operations agent): occupancy, rooms with free beds, a student's room, gate passes; approve or reject gate passes.

Admins and principal only (the hostel API is admin-only because it lists students and their reasons). Runs through HostelViewSet /
RoomViewSet / HostelAllocationViewSet / GatePassViewSet as the signed-in user. Writes only PROPOSE.
Left out on purpose: check-out and return of a pass (stay on the screen), vacating or allocating rooms, creating hostels / rooms.
"""
from ..internal_api import call
from ..registry import ADMINS, ProposalError, Tool, register
from . import lms_common as lc
from .student_tools import _fail, _items, resolve_student

LIST_LIMIT = 40


def _passes(ctx, **params):
    from hostel.views import GatePassViewSet

    st, body = call(ctx.user, ctx.school_id, GatePassViewSet, {'get': 'list'}, 'get', '/api/hostel/gate-passes/', {'page_size': 200, **params})
    if st != 200:
        raise ProposalError(_fail(body, 'Could not read the gate passes.'))
    return _items(body)


def _pass_row(p):
    return {'pass_id': p['id'], 'student': p['student_name'], 'hostel': p.get('hostel_name'), 'room': p.get('room_number'), 'type': p['pass_type_display'],
            'reason': (p.get('reason') or '')[:120], 'going_to': p.get('going_to'), 'leaves': p['departure_date'][:16].replace('T', ' '),
            'back_by': p['expected_return'][:16].replace('T', ' '), 'status': p['status_display']}


# ── reads ────────────────────────────────────────────────────────────────────

def get_hostel_summary(ctx):
    # The dashboard view is wrapped in a response cache keyed on the web request; its shared builder gives the same numbers.
    from hostel.views import build_dashboard_summary

    return build_dashboard_summary(ctx.school_id)


def list_rooms(ctx, hostel_name=None, only_with_free_beds=False):
    from hostel.views import RoomViewSet

    st, body = call(ctx.user, ctx.school_id, RoomViewSet, {'get': 'list'}, 'get', '/api/hostel/rooms/', {'page_size': 300, 'is_available': 'true'})
    if st != 200:
        raise ProposalError(_fail(body, 'Could not read the rooms.'))
    rows = _items(body)
    if hostel_name:
        want = lc.tokens(hostel_name)
        rows = [r for r in rows if all(w in lc.tokens(r['hostel_name']) for w in want)]
    if only_with_free_beds:
        rows = [r for r in rows if not r['is_full']]
    return {'count': len(rows), 'rooms': [{'hostel': r['hostel_name'], 'room': r['room_number'], 'floor': r['floor'], 'type': r['room_type_display'],
                                           'capacity': r['capacity'], 'occupied': r['current_occupancy'], 'free_beds': max(0, r['capacity'] - r['current_occupancy'])}
                                          for r in rows[:LIST_LIMIT]]}


def get_student_hostel(ctx, student_name=None, student_id=None, student_class=None):
    from hostel.views import HostelAllocationViewSet

    st_obj = resolve_student(ctx, student_id, student_name, student_class)
    st, body = call(ctx.user, ctx.school_id, HostelAllocationViewSet, {'get': 'list'}, 'get', '/api/hostel/allocations/', {'student_id': st_obj.id, 'page_size': 20})
    if st != 200:
        raise ProposalError(_fail(body, 'Could not read the allocation.'))
    rows = _items(body)
    return {'student': st_obj.name, 'allocations': [{'hostel': a['hostel_name'], 'room': a['room_number'], 'year': a['academic_year_name'],
                                                      'since': a['allocated_date'], 'vacated': a.get('vacated_date'), 'active': a['is_active']} for a in rows],
            **({} if rows else {'note': 'This student has no hostel allocation.'})}


def list_gate_passes(ctx, status=None, student_name=None, student_id=None, student_class=None):
    params = {k: v for k, v in {'status': status}.items() if v}
    if student_name or student_id:
        params['student_id'] = resolve_student(ctx, student_id, student_name, student_class).id
    rows = _passes(ctx, **params)
    return {'count': len(rows), 'passes': [_pass_row(p) for p in rows[:LIST_LIMIT]]}


# ── approve / reject ─────────────────────────────────────────────────────────

def _build_decide(ctx, payload):
    from hostel.models import GatePass

    rows, keep, warnings = [], [], []
    for pid in payload['pass_ids']:
        p = GatePass.objects.filter(school_id=ctx.school_id, id=pid).select_related('student', 'allocation__room__hostel').first()
        if p is None or p.status != 'PENDING':
            warnings.append(f'Pass {pid} is no longer pending and was removed.')
            continue
        keep.append(p.id)
        rows.append({'id': p.id, 'student': p.student.name, 'type': p.get_pass_type_display(), 'reason': (p.reason or '')[:60],
                     'leaves': p.departure_date.strftime('%d %b %H:%M'), 'back_by': p.expected_return.strftime('%d %b %H:%M'),
                     'decision': payload['decision']})
    if not rows:
        raise ProposalError('There is no pending gate pass left to decide on.')
    word = 'Approve' if payload['decision'] == 'APPROVED' else 'Reject'
    return {'payload': {**payload, 'pass_ids': keep}, 'preview': {
        'kind': 'gate_pass_decision', 'title': f'{word} gate pass', 'summary': f'{word} {len(rows)} gate pass(es)',
        'columns': ['Student', 'Type', 'Reason', 'Leaves', 'Back by', 'Decision'], 'rows': rows, 'totals': {'count': len(rows)},
        'warnings': warnings, 'assumptions': ({'remarks': payload['remarks']} if payload.get('remarks') else {}), 'editable': {'remove': True}}}


def decide_gate_pass(ctx, decision=None, pass_id=None, student_name=None, student_id=None, student_class=None, all_pending=False, remarks=None):
    decision = (decision or '').upper()
    if decision not in ('APPROVE', 'REJECT', 'APPROVED', 'REJECTED'):
        raise ProposalError('Approve or reject? Ask the user.')
    pending = _passes(ctx, status='PENDING')
    if pass_id:
        pending = [p for p in pending if p['id'] == int(pass_id)]
    elif student_name or student_id:
        sid = resolve_student(ctx, student_id, student_name, student_class).id
        pending = [p for p in pending if p['student'] == sid]
    elif not all_pending:
        raise ProposalError('Whose gate pass? Ask the user for a student name, or whether to decide on all pending passes.')
    if not pending:
        raise ProposalError('No pending gate pass matches that.')
    if not (pass_id or all_pending) and len(pending) > 1:
        raise ProposalError('That student has several pending passes: ' + '; '.join(f"pass_id {p['id']} ({p['pass_type_display']}, {p['departure_date'][:10]})" for p in pending[:8])
                            + '. Ask which, or whether to decide on all of them.')
    return _build_decide(ctx, {'kind': 'gate_pass_decision', 'pass_ids': [p['id'] for p in pending],
                               'decision': 'APPROVED' if decision.startswith('APPROVE') else 'REJECTED', 'remarks': (remarks or '')[:300]})


def revise_decide(ctx, payload, edits):
    drop = {int(i) for i in edits.get('remove_ids') or []}
    return _build_decide(ctx, {**payload, 'pass_ids': [i for i in payload['pass_ids'] if i not in drop]})


def apply_decide(ctx, payload):
    from hostel.views import GatePassViewSet

    act = 'approve' if payload['decision'] == 'APPROVED' else 'reject'
    done, errors = 0, []
    for pid in payload['pass_ids']:
        st, body = call(ctx.user, ctx.school_id, GatePassViewSet, {'patch': act}, 'patch', f'/api/hostel/gate-passes/{pid}/{act}/',
                        {'remarks': payload.get('remarks', '')}, pk=pid)
        if st == 200:
            done += 1
        else:
            errors.append(f'{pid}: {_fail(body, "failed")}')
    return {'ok': done > 0, 'decided': done, 'errors': errors, **({} if done else {'error': '; '.join(errors)[:300]})}


# ── registration ─────────────────────────────────────────────────────────────

_O = {'additionalProperties': False}
_WHO = {'student_name': {'type': 'string'}, 'student_id': {'type': 'integer'}, 'student_class': {'type': 'string', 'description': 'Class to tell same-named students apart'}}


def _read(name, desc, props, handler):
    register(Tool(name=name, description=desc, parameters={'type': 'object', **_O, 'properties': props}, handler=handler,
                  sub_agent='operations', module='hostel', roles=ADMINS))


_read('get_hostel_summary', 'Hostel overview: hostels, rooms, capacity, current occupancy, pending gate passes and students out on leave.', {}, get_hostel_summary)
_read('list_rooms', 'Hostel rooms with capacity, occupied and free beds.',
      {'hostel_name': {'type': 'string'}, 'only_with_free_beds': {'type': 'boolean'}}, list_rooms)
_read('get_student_hostel', "A student's hostel room and allocation history.", dict(_WHO), get_student_hostel)
_read('list_gate_passes', 'Hostel gate passes; filter by status (PENDING, APPROVED, REJECTED, USED, RETURNED, EXPIRED) or a named student.',
      {'status': {'type': 'string', 'enum': ['PENDING', 'APPROVED', 'REJECTED', 'USED', 'RETURNED', 'EXPIRED']}, **_WHO}, list_gate_passes)

register(Tool(
    name='decide_gate_pass',
    description=('PREPARE approving or rejecting PENDING hostel gate passes ("Ali ka gate pass approve kar do"): one student, one pass_id, or all_pending=true. '
                 'If a student has several pending passes, ask which. Nothing changes until the user approves the card. Check-out and return are not done from here.'),
    parameters={'type': 'object', **_O, 'properties': {'decision': {'type': 'string', 'enum': ['APPROVE', 'REJECT']}, 'pass_id': {'type': 'integer'}, **_WHO,
                                                       'all_pending': {'type': 'boolean'}, 'remarks': {'type': 'string'}}},
    handler=decide_gate_pass, sub_agent='operations', module='hostel', roles=ADMINS, kind='write', revise=revise_decide, apply=apply_decide,
))
