"""HR through Aura: staff directory, leave, staff attendance, salary look-ups, and the few writes agreed with the owner.

Every read and write goes through the HR viewsets as the signed-in user, so the app's own rules apply unchanged:
non-admins only ever see their own leave / attendance, the peer directory is trimmed to names and designations, and
only SUPER_ADMIN / SCHOOL_ADMIN / PRINCIPAL can write staff data. Writes only PROPOSE; a person presses Approve.

Left out on purpose: payroll and payslips, salary changes, role changes, creating user accounts, appraisals, documents.
"""
from datetime import date as date_cls

from django.utils import timezone

from ..internal_api import call
from ..registry import ADMINS, ProposalError, Tool, register
from . import lms_common as lc

STAFF_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'ON_LEAVE']
SELF_ROLES = ('TEACHER', 'STAFF', 'MANAGER', 'DRIVER')
DIRECTORY_ROLES = ADMINS + ('TEACHER', 'STAFF')          # the staff API blocks Manager outright
SALARY_ROLES = ADMINS                                     # owner decision 2026-11-08: principal sees salary too
LIST_LIMIT = 40
CONTACT_FIELDS = ('phone', 'email', 'address', 'emergency_contact_name', 'emergency_contact_phone')


# ── plumbing ─────────────────────────────────────────────────────────────────

def _items(body):
    if isinstance(body, dict) and 'results' in body:
        return body['results']
    return body if isinstance(body, list) else []


def _fail(body, fallback):
    return str((body or {}).get('detail') or (body or {}).get('error') or body or fallback)[:300]


def _is_admin(ctx):
    return ctx.role in ADMINS


def _my_staff(ctx):
    from hr.models import StaffMember
    staff = StaffMember.objects.filter(school_id=ctx.school_id, user_id=ctx.user.id).first()
    if staff is None:
        raise ProposalError('Your account is not linked to a staff profile, so there is no personal HR record to use.')
    return staff


def _day(value):
    d = lc.parse_date(value, 'date') if value else timezone.localdate()
    return d


def _one_staff(ctx, staff_id=None, staff_name=None):
    """Exactly one staff member of this school, or a ProposalError that makes the model ask."""
    from hr.models import StaffMember

    if staff_id:
        staff = StaffMember.objects.filter(school_id=ctx.school_id, id=int(staff_id)).first()
        if staff is None:
            raise ProposalError(f'No staff member with id {staff_id}.')
        return staff
    if not staff_name:
        raise ProposalError('Which staff member? Ask the user for a name.')
    hits = lc.find_staff(ctx, staff_name)
    if not hits:
        raise ProposalError(f'No staff member matching "{staff_name}".')
    if len(hits) > 1:
        raise ProposalError(f'"{staff_name}" matches several people: '
                            + '; '.join(f'{lc.staff_name(s)} (staff_id {s.id})' for s in hits[:8])
                            + '. Ask the user which one, then pass staff_id.')
    return hits[0]


def _leaves(ctx, **params):
    from hr.views import LeaveApplicationViewSet

    status, body = call(ctx.user, ctx.school_id, LeaveApplicationViewSet, {'get': 'list'}, 'get',
                        '/api/hr/leave-applications/', {'page_size': 200, **params})
    if status != 200:
        raise ProposalError(_fail(body, 'Could not read leave applications.'))
    return _items(body)


def _leave_row(a):
    return {'leave_id': a['id'], 'staff': a.get('staff_member_name'), 'staff_id': a.get('staff_member'),
            'type': a.get('leave_type_display') or a.get('leave_policy_name'), 'from': a['start_date'], 'to': a['end_date'],
            'days': a.get('total_days'), 'status': a.get('status'), 'reason': (a.get('reason') or '')[:120],
            **({'remarks': a['admin_remarks']} if a.get('admin_remarks') else {})}


# ── reads ────────────────────────────────────────────────────────────────────

def list_staff(ctx, search=None, department=None, employment_status=None):
    from hr.views import StaffMemberViewSet

    params = {'page_size': 200}
    if search:
        params['search'] = search
    if employment_status:
        params['employment_status'] = employment_status
    status, body = call(ctx.user, ctx.school_id, StaffMemberViewSet, {'get': 'list'}, 'get', '/api/hr/staff/', params)
    if status != 200:
        raise ProposalError(_fail(body, 'Could not read the staff list.'))
    rows = _items(body)
    if search and not rows:       # "Ahmad" vs "Ahmed": fall back to the fuzzy name match
        ids = [s.id for s in lc.find_staff(ctx, search)]
        if ids:
            status, body = call(ctx.user, ctx.school_id, StaffMemberViewSet, {'get': 'list'}, 'get', '/api/hr/staff/', {'page_size': 200})
            rows = [r for r in _items(body) if r['id'] in ids]
    if department:
        want = lc.tokens(department)
        rows = [r for r in rows if all(w in lc.tokens(r.get('department_name') or '') for w in want)]
    out = []
    for r in rows[:LIST_LIMIT]:
        row = {'staff_id': r['id'], 'name': r.get('full_name'), 'designation': r.get('designation_name'),
               'department': r.get('department_name'), 'status': r.get('employment_status'), 'role': r.get('user_role')}
        for key in ('employee_id', 'phone', 'email', 'employment_type', 'date_of_joining'):
            if key in r and r[key] not in (None, ''):         # a non-admin's peer view simply does not carry these
                row[key] = r[key]
        out.append(row)
    return {'count': len(rows), 'staff': out, **({'note': f'Showing the first {LIST_LIMIT}.'} if len(rows) > LIST_LIMIT else {})}


def get_leave_today(ctx, date=None):
    day = _day(date)
    rows = [a for a in _leaves(ctx, status='APPROVED')
            if date_cls.fromisoformat(a['start_date']) <= day <= date_cls.fromisoformat(a['end_date'])]
    return {'date': day, 'count': len(rows), 'on_leave': [_leave_row(a) for a in rows]}


def list_leave_requests(ctx, status=None, staff_name=None, staff_id=None):
    params = {'status': status} if status else {}
    if staff_name or staff_id:
        if _is_admin(ctx):
            params['staff_member'] = _one_staff(ctx, staff_id, staff_name).id
    rows = _leaves(ctx, **params)
    return {'count': len(rows), 'leave': [_leave_row(a) for a in rows[:LIST_LIMIT]],
            **({'note': f'Showing the first {LIST_LIMIT}.'} if len(rows) > LIST_LIMIT else {}),
            **({} if _is_admin(ctx) else {'scope': 'Only your own leave is shown.'})}


def get_leave_balance(ctx, staff_name=None, staff_id=None):
    from hr.views import LeaveApplicationViewSet

    staff = _one_staff(ctx, staff_id, staff_name) if _is_admin(ctx) and (staff_id or staff_name) else _my_staff(ctx)
    status, body = call(ctx.user, ctx.school_id, LeaveApplicationViewSet, {'get': 'leave_balance'}, 'get',
                        '/api/hr/leave-applications/leave_balance/', {'staff_member': staff.id})
    if status != 200:
        raise ProposalError(_fail(body, 'Could not read the leave balance.'))
    return {'staff': lc.staff_name(staff), 'year': timezone.localdate().year,
            'balances': [{'policy': b['policy_name'], 'type': b['leave_type_display'], 'allowed': b['days_allowed'],
                          'used': b['days_used'], 'remaining': b['days_remaining']} for b in body]}


def get_staff_attendance(ctx, date=None, status=None):
    from hr.models import StaffMember
    from hr.views import StaffAttendanceViewSet

    day = _day(date)
    st, body = call(ctx.user, ctx.school_id, StaffAttendanceViewSet, {'get': 'list'}, 'get',
                    '/api/hr/staff-attendance/', {'date': day.isoformat(), 'page_size': 500})
    if st != 200:
        raise ProposalError(_fail(body, 'Could not read staff attendance.'))
    rows = _items(body)
    marked = {r['staff_member'] for r in rows}
    active = list(StaffMember.objects.filter(school_id=ctx.school_id, is_active=True))
    counts = {k: sum(1 for r in rows if r['status'] == k) for k in STAFF_STATUSES}
    not_marked = [lc.staff_name(s) for s in active if s.id not in marked]
    listed = [r for r in rows if not status or r['status'] == status.upper()]
    return {'date': day, 'staff': len(active), 'counts': counts, 'not_marked': len(not_marked), 'not_marked_names': not_marked[:30],
            'records': [{'name': r['staff_member_name'], 'status': r['status'], 'check_in': r.get('check_in'), 'notes': r.get('notes') or None}
                        for r in listed[:LIST_LIMIT]]}


def get_staff_salary(ctx, staff_name=None, staff_id=None):
    from hr.views import SalaryStructureViewSet

    try:
        staff = _one_staff(ctx, staff_id, staff_name)
    except ProposalError as exc:
        # A misspelled "month" or "salary" in Roman Urdu gets read as a person's name; point at the tool for the whole month's bill.
        if str(exc).startswith('No staff member matching'):
            raise ProposalError(f'{exc} Do not ask the user or send them to a screen: if the question is about the whole school\'s salary bill '
                                'for a month, call get_payroll_summary now.')
        raise
    status, body = call(ctx.user, ctx.school_id, SalaryStructureViewSet, {'get': 'current'}, 'get',
                        '/api/hr/salary-structures/current/', {'staff_member': staff.id})
    if status == 404:
        return {'staff': lc.staff_name(staff), 'note': 'No active salary structure is set for this person.'}
    if status != 200:
        raise ProposalError(_fail(body, 'Could not read the salary.'))
    return {'staff': lc.staff_name(staff), 'basic': body['basic_salary'], 'allowances': body.get('allowances'),
            'deductions': body.get('deductions'), 'gross': body['gross_salary'], 'total_deductions': body['total_deductions'],
            'net': body['net_salary'], 'effective_from': body['effective_from']}


# ── approving / rejecting leave ──────────────────────────────────────────────

def _build_decision(ctx, payload):
    from hr.models import LeaveApplication

    rows, warnings, keep = [], [], []
    for lid in payload['leave_ids']:
        a = LeaveApplication.objects.filter(school_id=ctx.school_id, id=lid).select_related('staff_member', 'leave_policy').first()
        if a is None:
            warnings.append(f'Leave {lid} no longer exists and was removed.')
            continue
        if a.status != 'PENDING':
            warnings.append(f'{lc.staff_name(a.staff_member)}\'s request is already {a.get_status_display().lower()} and was removed.')
            continue
        keep.append(lid)
        rows.append({'id': a.id, 'staff': lc.staff_name(a.staff_member), 'type': a.leave_policy.name if a.leave_policy else 'Leave',
                     'from': a.start_date, 'to': a.end_date, 'days': a.total_days, 'reason': (a.reason or '')[:80],
                     'decision': payload['decision']})
    if not rows:
        raise ProposalError('There is no pending leave request left to decide on.')
    word = 'Approve' if payload['decision'] == 'APPROVED' else 'Reject'
    warnings.append('The staff member is notified of the decision.')
    return {'payload': {**payload, 'leave_ids': keep}, 'preview': {
        'kind': 'leave_decision', 'title': f'{word} leave', 'summary': f'{word} {len(rows)} leave request(s)',
        'columns': ['Staff', 'Type', 'From', 'To', 'Days', 'Decision'], 'rows': rows, 'totals': {'count': len(rows)},
        'warnings': warnings, 'assumptions': {**({'remarks': payload['remarks']} if payload.get('remarks') else {})},
        'editable': {'remove': True},
    }}


def decide_leave(ctx, decision=None, leave_id=None, staff_name=None, staff_id=None, remarks=None, all_pending=False):
    decision = (decision or '').upper()
    if decision not in ('APPROVE', 'REJECT', 'APPROVED', 'REJECTED'):
        raise ProposalError('Approve or reject? Ask the user.')
    pending = _leaves(ctx, status='PENDING')
    if leave_id:
        pending = [a for a in pending if a['id'] == int(leave_id)]
    elif staff_name or staff_id:
        who = _one_staff(ctx, staff_id, staff_name)
        pending = [a for a in pending if a['staff_member'] == who.id]
    elif not all_pending:
        raise ProposalError('Whose leave? Ask the user for a name, or whether to decide on all pending requests.')
    if not pending:
        raise ProposalError('No pending leave request matches that.')
    if not leave_id and not all_pending and len(pending) > 1:
        raise ProposalError('That person has several pending requests: ' + '; '.join(
            f"leave_id {a['id']} ({a['start_date']} to {a['end_date']})" for a in pending[:8]) + '. Ask which, or whether to decide on all of them.')
    return _build_decision(ctx, {'kind': 'leave_decision', 'leave_ids': [a['id'] for a in pending],
                                 'decision': 'APPROVED' if decision.startswith('APPROVE') else 'REJECTED',
                                 'remarks': (remarks or '')[:300]})


def revise_decision(ctx, payload, edits):
    drop = {int(i) for i in edits.get('remove_ids') or []}
    payload = {**payload, 'leave_ids': [i for i in payload['leave_ids'] if i not in drop]}
    return _build_decision(ctx, payload)


def apply_decision(ctx, payload):
    from hr.views import LeaveApplicationViewSet

    act = 'approve' if payload['decision'] == 'APPROVED' else 'reject'
    done, errors = [], []
    for lid in payload['leave_ids']:
        status, body = call(ctx.user, ctx.school_id, LeaveApplicationViewSet, {'post': act}, 'post',
                            f'/api/hr/leave-applications/{lid}/{act}/', {'admin_remarks': payload.get('remarks', '')}, pk=lid)
        (done if status == 200 else errors).append(lid if status == 200 else f'{lid}: {_fail(body, "failed")}')
    return {'ok': bool(done), 'decided': len(done), 'errors': errors, **({} if done else {'error': '; '.join(errors)[:300]})}


# ── applying for leave (self) ────────────────────────────────────────────────

def _policy(ctx, leave_type):
    from hr.models import LeavePolicy

    pols = list(LeavePolicy.objects.filter(school_id=ctx.school_id, is_active=True))
    if not pols:
        return None
    if not leave_type:
        if len(pols) == 1:
            return pols[0]
        raise ProposalError('Which type of leave? ' + ', '.join(p.name for p in pols) + '. Ask the user.')
    want = lc.tokens(leave_type)
    hits = [p for p in pols if all(w in lc.tokens(f'{p.name} {p.leave_type}') for w in want)]
    if len(hits) != 1:
        raise ProposalError(f'Leave type "{leave_type}" is not clear. Available: ' + ', '.join(p.name for p in pols) + '. Ask the user.')
    return hits[0]


def _build_apply(ctx, payload):
    from hr.models import LeaveApplication, LeavePolicy

    staff = _my_staff(ctx)
    start, end = lc.parse_date(payload['start_date'], 'start_date'), lc.parse_date(payload['end_date'], 'end_date')
    if start > end:
        raise ProposalError('The end date is before the start date.')
    days = (end - start).days + 1
    policy = LeavePolicy.objects.filter(school_id=ctx.school_id, id=payload.get('policy')).first() if payload.get('policy') else None
    warnings = []
    if start < timezone.localdate():
        warnings.append('The start date is in the past.')
    if LeaveApplication.objects.filter(school_id=ctx.school_id, staff_member=staff, status__in=['PENDING', 'APPROVED'],
                                       start_date__lte=end, end_date__gte=start).exists():
        warnings.append('You already have a leave request that overlaps these dates.')
    if policy:
        year = start.year
        used = sum(a.total_days for a in LeaveApplication.objects.filter(
            school_id=ctx.school_id, staff_member=staff, leave_policy=policy, status='APPROVED', start_date__year=year))
        if used + days > policy.days_allowed:
            warnings.append(f'This is more than the {policy.name} left: {max(0, policy.days_allowed - used)} of {policy.days_allowed} day(s).')
    warnings.append('The request goes to your school admin as pending. It is not approved by being sent.')
    rows = [{'field': 'Type', 'value': policy.name if policy else 'Leave'}, {'field': 'From', 'value': start.isoformat()},
            {'field': 'To', 'value': end.isoformat()}, {'field': 'Days', 'value': days}, {'field': 'Reason', 'value': payload['reason']}]
    return {'payload': payload, 'preview': {
        'kind': 'leave_apply', 'title': 'Apply for leave', 'summary': f'{days} day(s) from {start} to {end}',
        'columns': ['Field', 'Value'], 'rows': rows, 'totals': {'count': 1}, 'warnings': warnings, 'editable': {},
    }}


def apply_for_leave(ctx, start_date=None, end_date=None, reason=None, leave_type=None):
    _my_staff(ctx)
    if not start_date:
        raise ProposalError('From which date? Ask the user.')
    if not reason:
        raise ProposalError('What is the reason for the leave? Ask the user.')
    policy = _policy(ctx, leave_type)
    return _build_apply(ctx, {'kind': 'leave_apply', 'start_date': start_date, 'end_date': end_date or start_date,
                              'reason': reason[:500], 'policy': policy.id if policy else None})


def revise_apply(ctx, payload, edits):
    return _build_apply(ctx, payload)


def apply_apply(ctx, payload):
    from hr.views import LeaveApplicationViewSet

    staff = _my_staff(ctx)
    data = {'staff_member': staff.id, 'start_date': payload['start_date'], 'end_date': payload['end_date'], 'reason': payload['reason'],
            **({'leave_policy': payload['policy']} if payload.get('policy') else {})}
    status, body = call(ctx.user, ctx.school_id, LeaveApplicationViewSet, {'post': 'create'}, 'post', '/api/hr/leave-applications/', data)
    if status not in (200, 201):
        return {'ok': False, 'error': _fail(body, 'The leave request could not be sent.')}
    return {'ok': True, 'leave_id': (body or {}).get('id')}


# ── staff attendance ─────────────────────────────────────────────────────────

def _existing_att(ctx, ids, day):
    from hr.models import StaffAttendance
    return dict(StaffAttendance.objects.filter(school_id=ctx.school_id, date=day, staff_member_id__in=ids).values_list('staff_member_id', 'status'))


def _build_att(ctx, payload):
    from hr.models import StaffMember

    day = _day(payload['date'])
    if day > timezone.localdate():
        raise ProposalError('Attendance cannot be marked for a future date.')
    staff = {s.id: s for s in StaffMember.objects.filter(school_id=ctx.school_id, is_active=True, id__in=[e['staff_id'] for e in payload['entries']])}
    existing = _existing_att(ctx, list(staff), day)
    entries, rows, warnings = [], [], []
    for e in payload['entries']:
        s = staff.get(e['staff_id'])
        if s is None:
            warnings.append(f"Staff {e['staff_id']} is not an active staff member and was removed.")
            continue
        was = existing.get(s.id, 'NOT MARKED')
        entries.append({'staff_id': s.id, 'status': e['status'], 'was': was})
        rows.append({'staff_id': s.id, 'staff': lc.staff_name(s), 'was': was, 'status': e['status']})
    if not entries:
        raise ProposalError('Nothing to save.')
    counts = {k: sum(1 for r in rows if r['status'] == k) for k in STAFF_STATUSES}
    replaced = sum(1 for r in rows if r['was'] != 'NOT MARKED' and r['was'] != r['status'])
    if replaced:
        warnings.append(f'{replaced} existing record(s) will be replaced.')
    from academic_sessions.calendar_rules import is_off_day_for_date
    if is_off_day_for_date(ctx.school_id, day, for_staff=True):
        warnings.append('The school calendar marks this day as off, so the app will record everyone as ON_LEAVE whatever is chosen here.')
    return {'payload': {**payload, 'entries': entries}, 'preview': {
        'kind': 'staff_attendance', 'title': 'Mark staff attendance',
        'summary': f'{day}: ' + ', '.join(f'{v} {k.lower().replace("_", " ")}' for k, v in counts.items() if v),
        'columns': ['Staff', 'Now', 'Will be'], 'rows': rows, 'totals': {'count': len(rows), **{k.lower(): v for k, v in counts.items()}},
        'warnings': warnings, 'assumptions': {'date': day.isoformat()}, 'editable': {'statuses': STAFF_STATUSES},
    }}


def mark_staff_attendance(ctx, date=None, entries=None, rest=None):
    from hr.models import StaffMember

    day = _day(date)
    if not entries and not rest:
        raise ProposalError('Who to mark, and as what? Ask the user.')
    chosen = {}
    for item in entries or []:
        status = (item.get('status') or '').upper().replace(' ', '_')
        if status not in STAFF_STATUSES:
            raise ProposalError(f'Status must be one of {", ".join(STAFF_STATUSES)}.')
        s = _one_staff(ctx, item.get('staff_id'), item.get('staff_name'))
        if s.id in chosen and chosen[s.id] != status:
            raise ProposalError(f'{lc.staff_name(s)} is given two different statuses. Ask the user which is right.')
        chosen[s.id] = status
    if rest:
        rest = rest.upper().replace(' ', '_')
        if rest not in STAFF_STATUSES:
            raise ProposalError(f'"rest" must be one of {", ".join(STAFF_STATUSES)}.')
        for s in StaffMember.objects.filter(school_id=ctx.school_id, is_active=True):
            chosen.setdefault(s.id, rest)
    return _build_att(ctx, {'kind': 'staff_attendance', 'date': day.isoformat(),
                            'entries': [{'staff_id': sid, 'status': st} for sid, st in chosen.items()]})


def revise_att(ctx, payload, edits):
    payload = {**payload, 'entries': [dict(e) for e in payload['entries']]}
    by_id = {e['staff_id']: e for e in payload['entries']}
    drop = {int(i) for i in edits.get('remove_ids') or []}
    for sid, status in (edits.get('statuses') or {}).items():
        if int(sid) not in by_id:
            raise ProposalError(f'Staff {sid} is not on this card.')
        if status not in STAFF_STATUSES:
            raise ProposalError(f'Status must be one of {", ".join(STAFF_STATUSES)}.')
        by_id[int(sid)]['status'] = status
    payload['entries'] = [e for e in payload['entries'] if e['staff_id'] not in drop]
    return _build_att(ctx, payload)


def apply_att(ctx, payload):
    from hr.views import StaffAttendanceViewSet

    data = {'date': payload['date'], 'records': [{'staff_member': e['staff_id'], 'status': e['status']} for e in payload['entries']]}
    status, body = call(ctx.user, ctx.school_id, StaffAttendanceViewSet, {'post': 'bulk_mark'}, 'post',
                        '/api/hr/staff-attendance/bulk_mark/', data)
    if status != 200:
        return {'ok': False, 'error': _fail(body, 'Attendance could not be saved.')}
    saved = body.get('created', 0) + body.get('updated', 0)
    return {'ok': saved > 0, 'saved': saved, 'created': body.get('created', 0), 'updated': body.get('updated', 0)}


# ── contact details ──────────────────────────────────────────────────────────

_LABELS = {'phone': 'Phone', 'email': 'Email', 'address': 'Address',
           'emergency_contact_name': 'Emergency contact', 'emergency_contact_phone': 'Emergency phone'}


def _build_contact(ctx, payload):
    from hr.models import StaffMember

    staff = StaffMember.objects.filter(school_id=ctx.school_id, id=payload['staff_id']).first()
    if staff is None:
        raise ProposalError('That staff member no longer exists.')
    rows = [{'field': _LABELS[k], 'from': getattr(staff, k) or 'not set', 'to': v or 'cleared'}
            for k, v in payload['changes'].items() if (getattr(staff, k) or '') != (v or '')]
    if not rows:
        raise ProposalError(f'{lc.staff_name(staff)} already has those details. Nothing to change.')
    if 'email' in payload['changes'] and payload['changes']['email'] and '@' not in payload['changes']['email']:
        raise ProposalError('That does not look like an email address.')
    return {'payload': payload, 'preview': {
        'kind': 'edit_entry', 'title': 'Update staff contact details', 'summary': f'{lc.staff_name(staff)}: {len(rows)} detail(s)',
        'columns': ['Field', 'From', 'To'], 'rows': rows, 'totals': {'count': len(rows)}, 'warnings': [], 'editable': {},
    }}


def update_staff_contact(ctx, staff_name=None, staff_id=None, **changes):
    staff = _one_staff(ctx, staff_id, staff_name)
    changes = {k: str(v).strip() for k, v in changes.items() if k in CONTACT_FIELDS and v is not None}
    if not changes:
        raise ProposalError('Which detail to change (phone, email, address, emergency contact)? Ask the user.')
    return _build_contact(ctx, {'kind': 'edit_entry', 'staff_id': staff.id, 'changes': changes})


def revise_contact(ctx, payload, edits):
    return _build_contact(ctx, payload)


def apply_contact(ctx, payload):
    from hr.views import StaffMemberViewSet

    sid = payload['staff_id']
    status, body = call(ctx.user, ctx.school_id, StaffMemberViewSet, {'patch': 'partial_update'}, 'patch',
                        f'/api/hr/staff/{sid}/', payload['changes'], pk=sid)
    if status != 200:
        return {'ok': False, 'error': _fail(body, 'The details could not be saved.')}
    return {'ok': True, 'changed': list(payload['changes'])}


# ── registration ─────────────────────────────────────────────────────────────

_O = {'additionalProperties': False}
_DATE = {'type': 'string', 'description': 'YYYY-MM-DD, defaults to today'}
_WHO = {'staff_name': {'type': 'string', 'description': 'Spoken name of the staff member'},
        'staff_id': {'type': 'integer', 'description': 'Exact id when known (from list_staff)'}}


def _read(name, desc, props, handler, roles):
    register(Tool(name=name, description=desc, parameters={'type': 'object', **_O, 'properties': props},
                  handler=handler, sub_agent='hr', module='hr', roles=roles))


_read('list_staff', 'Staff directory: name, designation, department, status; admins also get phone, email and employee id. '
      'Use for "who is the librarian?", "list science department staff".',
      {'search': {'type': 'string', 'description': 'Part of a name'}, 'department': {'type': 'string'},
       'employment_status': {'type': 'string', 'enum': ['ACTIVE', 'ON_LEAVE', 'TERMINATED', 'RESIGNED', 'RETIRED']}}, list_staff, DIRECTORY_ROLES)
_read('get_leave_today', 'Who is on approved leave on a date (default today): "who is on leave today", staff or teachers absent on leave.', {'date': _DATE}, get_leave_today, ADMINS)
_read('list_leave_requests', 'Leave requests, newest first; filter by status or person. Admins see everyone, anyone else sees only their own.',
      {'status': {'type': 'string', 'enum': ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']}, **_WHO}, list_leave_requests, ADMINS + SELF_ROLES)
_read('get_leave_balance', "Leave days allowed / used / remaining this year per policy. Admins can name anyone; everyone else gets their own.",
      dict(_WHO), get_leave_balance, ADMINS + SELF_ROLES)
_read('get_staff_attendance', "Staff attendance for a date: counts, who has not been marked, and the records.",
      {'date': _DATE, 'status': {'type': 'string', 'enum': STAFF_STATUSES}}, get_staff_attendance, ADMINS)
_read('get_staff_salary', "ONE named staff member's current salary structure (basic, allowances, deductions, gross, net). Admins and principal only. "
        "Not for the school's salary bill for a month: that is get_payroll_summary.",
      dict(_WHO), get_staff_salary, SALARY_ROLES)

register(Tool(
    name='decide_leave',
    description=('PREPARE approving or rejecting pending leave ("approve Sana\'s leave"). Name the person, or pass leave_id, or all_pending=true '
                 'for every pending request. If a person has several pending requests, ask which. Nothing changes until the user presses Approve '
                 'on the card, and the staff member is notified then.'),
    parameters={'type': 'object', **_O, 'properties': {
        'decision': {'type': 'string', 'enum': ['APPROVE', 'REJECT']}, 'leave_id': {'type': 'integer'}, **_WHO,
        'all_pending': {'type': 'boolean'}, 'remarks': {'type': 'string', 'description': 'Optional note to the staff member'}}},
    handler=decide_leave, sub_agent='hr', module='hr', roles=ADMINS, kind='write', revise=revise_decision, apply=apply_decision,
))
register(Tool(
    name='apply_leave',
    description=('PREPARE a leave request for the signed-in staff member themself ("mujhe kal ki chutti chahiye, bimari"). Never for someone else. '
                 'Needs the start date and a reason; ask if missing. The request is sent as pending only after the user approves the card.'),
    parameters={'type': 'object', **_O, 'properties': {
        'start_date': _DATE, 'end_date': {'type': 'string', 'description': 'YYYY-MM-DD, defaults to the start date'},
        'reason': {'type': 'string'}, 'leave_type': {'type': 'string', 'description': 'e.g. sick, casual, annual'}}},
    handler=apply_for_leave, sub_agent='hr', module='hr', roles=ADMINS + SELF_ROLES, kind='write', revise=revise_apply, apply=apply_apply,
))
register(Tool(
    name='mark_staff_attendance',
    description=('PREPARE staff attendance for a date (default today): "Sana and Ali absent, rest present". Statuses: PRESENT, ABSENT, LATE, HALF_DAY, ON_LEAVE. '
                 '`rest` fills every other active staff member. Not for future dates. Nothing is saved until the user approves.'),
    parameters={'type': 'object', **_O, 'properties': {
        'date': _DATE, 'rest': {'type': 'string', 'enum': STAFF_STATUSES},
        'entries': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'properties': {
            **_WHO, 'status': {'type': 'string', 'enum': STAFF_STATUSES}}}}}},
    handler=mark_staff_attendance, sub_agent='hr', module='hr', roles=ADMINS, kind='write', revise=revise_att, apply=apply_att,
))
register(Tool(
    name='update_staff_contact',
    description=('PREPARE a change to a staff member\'s contact details only: phone, email, address, emergency contact name / phone. '
                 'Pass the staff name directly (staff_name); do NOT use find_student, which is for students. '
                 'Nothing else about a staff record can be changed here. Nothing is saved until the user approves.'),
    parameters={'type': 'object', **_O, 'properties': {**_WHO, **{k: {'type': 'string'} for k in CONTACT_FIELDS}}},
    handler=update_staff_contact, sub_agent='hr', module='hr', roles=ADMINS, kind='write', revise=revise_contact, apply=apply_contact,
))
