"""Payroll through Aura (owner decision 2026-11-08): payroll summary, payslips, and four writes that each show a preview card:
generate the month's DRAFT payslips, approve drafts, mark approved payslips paid, delete drafts.

Everything runs through PayslipViewSet / SalaryStructureViewSet as the signed-in user, so the app's rules apply unchanged
(only SUPER_ADMIN / SCHOOL_ADMIN / PRINCIPAL can write; anyone else only ever sees their own payslip).
Not here on purpose: editing a salary structure, editing one payslip's amounts, role changes.
"""
from decimal import Decimal

from django.utils import timezone

from ..internal_api import call
from ..registry import ADMINS, ProposalError, Tool, register
from . import lms_common as lc
from .hr_tools import SELF_ROLES, _fail, _items, _my_staff, _one_staff

MAX_BATCH = 100
LIST_LIMIT = 40
MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']


# ── plumbing ─────────────────────────────────────────────────────────────────

def _period(month, year):
    today = timezone.localdate()
    m, y = int(month or today.month), int(year or today.year)
    if not 1 <= m <= 12:
        raise ProposalError('Month must be between 1 and 12.')
    if not 2000 <= y <= 2100:
        raise ProposalError('Year must be between 2000 and 2100.')
    return m, y


def _label(m, y):
    return f'{MONTHS[m - 1]} {y}'


def _money(value):
    return float(Decimal(str(value or 0)))


def _payslips(ctx, **params):
    from hr.views import PayslipViewSet

    status, body = call(ctx.user, ctx.school_id, PayslipViewSet, {'get': 'list'}, 'get', '/api/hr/payslips/', {'page_size': 500, **params})
    if status != 200:
        raise ProposalError(_fail(body, 'Could not read payslips.'))
    return _items(body)


def _row(p):
    return {'payslip_id': p['id'], 'staff': p.get('staff_member_name'), 'staff_id': p.get('staff_member'),
            'period': _label(p['month'], p['year']), 'basic': _money(p['basic_salary']), 'allowances': _money(p['total_allowances']),
            'deductions': _money(p['total_deductions']), 'net': _money(p['net_salary']), 'status': p['status'],
            **({'paid_on': p['payment_date']} if p.get('payment_date') else {})}


# ── reads ────────────────────────────────────────────────────────────────────

def get_payroll_summary(ctx, month=None, year=None):
    from hr.views import PayslipViewSet

    m, y = _period(month, year)
    status, body = call(ctx.user, ctx.school_id, PayslipViewSet, {'get': 'payroll_summary'}, 'get',
                        '/api/hr/payslips/payroll_summary/', {'month': m, 'year': y})
    if status != 200:
        raise ProposalError(_fail(body, 'Could not read the payroll summary.'))
    return {'period': _label(m, y), 'payslips': body['total_payslips'], 'total_basic': _money(body['total_basic']),
            'total_allowances': _money(body['total_allowances']), 'total_deductions': _money(body['total_deductions']),
            'total_net': _money(body['total_net']), 'draft': body['draft_count'], 'approved': body['approved_count'], 'paid': body['paid_count']}


def list_payslips(ctx, month=None, year=None, status=None, staff_name=None, staff_id=None):
    m, y = _period(month, year)
    params = {'month': m, 'year': y, **({'status': status} if status else {})}
    if staff_name or staff_id:
        params['staff_member'] = _one_staff(ctx, staff_id, staff_name).id
    rows = _payslips(ctx, **params)
    return {'period': _label(m, y), 'count': len(rows), 'total_net': round(sum(_money(p['net_salary']) for p in rows), 2),
            'payslips': [_row(p) for p in rows[:LIST_LIMIT]],
            **({'note': f'Showing the first {LIST_LIMIT}.'} if len(rows) > LIST_LIMIT else {})}


def get_my_payslip(ctx, month=None, year=None):
    m, y = _period(month, year)
    me = _my_staff(ctx)
    rows = _payslips(ctx, month=m, year=y, staff_member=me.id)
    if not rows:
        return {'period': _label(m, y), 'note': 'No payslip has been generated for you for this month yet.'}
    p = rows[0]
    return {**_row(p), 'allowance_breakdown': p.get('allowances_breakdown'), 'deduction_breakdown': p.get('deductions_breakdown')}


def get_payroll_pending(ctx, month=None, year=None):
    from hr.models import Payslip, SalaryStructure, StaffMember
    from django.db.models import Q

    m, y = _period(month, year)
    today = timezone.localdate()
    staff = list(StaffMember.objects.filter(school_id=ctx.school_id, is_active=True, employment_status='ACTIVE'))
    have = set(Payslip.objects.filter(school_id=ctx.school_id, month=m, year=y).values_list('staff_member_id', flat=True))
    with_salary = set(SalaryStructure.objects.filter(school_id=ctx.school_id, is_active=True, effective_from__lte=today)
                      .filter(Q(effective_to__isnull=True) | Q(effective_to__gte=today)).values_list('staff_member_id', flat=True))
    missing = [s for s in staff if s.id not in have]
    counts = {s: Payslip.objects.filter(school_id=ctx.school_id, month=m, year=y, status=s).count() for s in ('DRAFT', 'APPROVED', 'PAID')}
    return {'period': _label(m, y), 'active_staff': len(staff), 'without_payslip': len(missing),
            'without_payslip_and_salary': [lc.staff_name(s) for s in missing if s.id not in with_salary][:30],
            'can_generate_for': sum(1 for s in missing if s.id in with_salary),
            'drafts_to_approve': counts['DRAFT'], 'approved_to_pay': counts['APPROVED'], 'paid': counts['PAID']}


# ── generate ─────────────────────────────────────────────────────────────────

def _build_generate(ctx, payload):
    from hr.models import Payslip, SalaryStructure, StaffMember
    from django.db.models import Q

    m, y = payload['month'], payload['year']
    today = timezone.localdate()
    staff = list(StaffMember.objects.filter(school_id=ctx.school_id, is_active=True, employment_status='ACTIVE'))
    have = set(Payslip.objects.filter(school_id=ctx.school_id, month=m, year=y).values_list('staff_member_id', flat=True))
    sal = {}
    for s in SalaryStructure.objects.filter(school_id=ctx.school_id, is_active=True, effective_from__lte=today).filter(
            Q(effective_to__isnull=True) | Q(effective_to__gte=today)).order_by('staff_member_id', '-effective_from'):
        sal.setdefault(s.staff_member_id, s)
    new = [s for s in staff if s.id not in have and s.id in sal]
    if not new:
        raise ProposalError(f'Nothing to generate for {_label(m, y)}: every active staff member with a salary already has a payslip.')
    rows = [{'staff': lc.staff_name(s), 'basic': _money(sal[s.id].basic_salary), 'net': _money(sal[s.id].net_salary)} for s in new]
    total = round(sum(r['net'] for r in rows), 2)
    warnings = ['Payslips are created as DRAFT. Approving and paying are separate steps.']
    if len(have):
        warnings.append(f'{len(have)} staff already have a payslip for this month and are not touched.')
    no_salary = [lc.staff_name(s) for s in staff if s.id not in have and s.id not in sal]
    if no_salary:
        warnings.append(f'{len(no_salary)} have no salary structure and are skipped: ' + ', '.join(no_salary[:8]))
    if (y, m) > (today.year, today.month):
        warnings.append('This month has not started yet.')
    return {'payload': payload, 'preview': {
        'kind': 'payslips_generate', 'title': 'Generate payslips', 'summary': f'{len(rows)} draft payslip(s) for {_label(m, y)}, total net Rs {total:,.0f}',
        'columns': ['Staff', 'Basic', 'Net'], 'rows': rows[:MAX_BATCH], 'totals': {'count': len(rows), 'net': total},
        'warnings': warnings + ([f'Showing the first {MAX_BATCH} of {len(rows)}.'] if len(rows) > MAX_BATCH else []), 'editable': {},
    }}


def generate_payslips(ctx, month=None, year=None):
    m, y = _period(month, year)
    return _build_generate(ctx, {'kind': 'payslips_generate', 'month': m, 'year': y})


def revise_generate(ctx, payload, edits):
    return _build_generate(ctx, payload)


def apply_generate(ctx, payload):
    from hr.views import PayslipViewSet

    status, body = call(ctx.user, ctx.school_id, PayslipViewSet, {'post': 'generate_payslips'}, 'post', '/api/hr/payslips/generate_payslips/',
                        {'month': payload['month'], 'year': payload['year']})
    if status not in (200, 202):
        return {'ok': False, 'error': _fail(body, 'Payslips could not be generated.')}
    return {'ok': True, 'message': (body or {}).get('message'), 'started_in_background': status == 202}


# ── approve / pay / delete: one shared selection ─────────────────────────────

_RULES = {
    # kind: (required current status, new status, card title, verb)
    'payslips_approve': ('DRAFT', 'APPROVED', 'Approve payslips', 'Approve'),
    'payslips_pay': ('APPROVED', 'PAID', 'Mark payslips paid', 'Mark paid'),
    'payslips_delete': ('DRAFT', None, 'Delete draft payslips', 'Delete'),
}


def _build_batch(ctx, payload):
    from hr.models import Payslip

    kind = payload['kind']
    need, new, title, verb = _RULES[kind]
    qs = Payslip.objects.filter(school_id=ctx.school_id, id__in=payload['ids']).select_related('staff_member')
    rows, keep, warnings, skipped = [], [], [], 0
    for p in qs:
        if p.status != need:
            skipped += 1
            continue
        keep.append(p.id)
        rows.append({'id': p.id, 'staff': lc.staff_name(p.staff_member), 'period': _label(p.month, p.year), 'net': _money(p.net_salary),
                     'from': p.status, 'to': new or 'DELETED'})
    if skipped:
        warnings.append(f'{skipped} payslip(s) are no longer {need.lower()} and were removed from this card.')
    if not rows:
        raise ProposalError(f'There is no {need.lower()} payslip left to {verb.lower()}.')
    if len(rows) > MAX_BATCH:
        raise ProposalError(f'That is {len(rows)} payslips; at most {MAX_BATCH} at a time. Narrow it by month or person.')
    total = round(sum(r['net'] for r in rows), 2)
    extra = {}
    if kind == 'payslips_pay':
        day = lc.parse_date(payload['payment_date'], 'payment_date')
        if day > timezone.localdate():
            raise ProposalError('The payment date cannot be in the future.')
        extra['payment date'] = day.isoformat()
        warnings.append(f'This records Rs {total:,.0f} as paid on {day}. It does not send any money.')
    elif kind == 'payslips_approve':
        warnings.append('Approved payslips can then be marked paid.')
    else:
        warnings.append('The draft payslips are removed. This cannot be undone; they can be generated again.')
    return {'payload': {**payload, 'ids': keep}, 'preview': {
        'kind': 'delete_payslips' if kind == 'payslips_delete' else 'payslip_batch', 'title': title,
        'summary': f'{verb} {len(rows)} payslip(s), total net Rs {total:,.0f}',
        'columns': ['Staff', 'Month', 'Net pay', 'Now', 'Will be'], 'rows': rows, 'totals': {'count': len(rows), 'net': total},
        'warnings': warnings, 'assumptions': extra, 'editable': {'remove': True},
    }}


def _select(ctx, kind, month, year, staff_name, staff_id, staff_names):
    need = _RULES[kind][0]
    m, y = _period(month, year)
    params = {'month': m, 'year': y, 'status': need}
    if staff_name or staff_id:
        params['staff_member'] = _one_staff(ctx, staff_id, staff_name).id
    rows = _payslips(ctx, **params)
    if staff_names:
        wanted = {_one_staff(ctx, None, n).id for n in staff_names}
        rows = [p for p in rows if p['staff_member'] in wanted]
    if not rows:
        raise ProposalError(f'No {need.lower()} payslip found for {_label(m, y)}' + (' for that person.' if staff_name or staff_id or staff_names else '.'))
    return [p['id'] for p in rows]


def approve_payslips(ctx, month=None, year=None, staff_name=None, staff_id=None, staff_names=None):
    ids = _select(ctx, 'payslips_approve', month, year, staff_name, staff_id, staff_names)
    return _build_batch(ctx, {'kind': 'payslips_approve', 'ids': ids})


def mark_payslips_paid(ctx, month=None, year=None, staff_name=None, staff_id=None, staff_names=None, payment_date=None):
    ids = _select(ctx, 'payslips_pay', month, year, staff_name, staff_id, staff_names)
    day = (lc.parse_date(payment_date, 'payment_date') if payment_date else timezone.localdate()).isoformat()
    return _build_batch(ctx, {'kind': 'payslips_pay', 'ids': ids, 'payment_date': day})


def delete_draft_payslips(ctx, month=None, year=None, staff_name=None, staff_id=None, staff_names=None):
    ids = _select(ctx, 'payslips_delete', month, year, staff_name, staff_id, staff_names)
    return _build_batch(ctx, {'kind': 'payslips_delete', 'ids': ids})


def revise_batch(ctx, payload, edits):
    drop = {int(i) for i in edits.get('remove_ids') or []}
    return _build_batch(ctx, {**payload, 'ids': [i for i in payload['ids'] if i not in drop]})


def apply_batch(ctx, payload):
    from hr.views import PayslipViewSet

    kind = payload['kind']
    if kind == 'payslips_delete':
        status, body = call(ctx.user, ctx.school_id, PayslipViewSet, {'post': 'bulk_delete'}, 'post', '/api/hr/payslips/bulk_delete/', {'ids': payload['ids']})
        if status != 200:
            return {'ok': False, 'error': _fail(body, 'The payslips could not be deleted.')}
        return {'ok': body.get('deleted', 0) > 0, 'deleted': body.get('deleted', 0)}
    act = 'approve' if kind == 'payslips_approve' else 'mark_paid'
    data = {'payment_date': payload['payment_date']} if kind == 'payslips_pay' else {}
    done, errors = 0, []
    for pid in payload['ids']:
        status, body = call(ctx.user, ctx.school_id, PayslipViewSet, {'post': act}, 'post', f'/api/hr/payslips/{pid}/{act}/', data, pk=pid)
        if status == 200:
            done += 1
        else:
            errors.append(f'{pid}: {_fail(body, "failed")}')
    return {'ok': done > 0, 'done': done, 'errors': errors, **({} if done else {'error': '; '.join(errors)[:300]})}


# ── registration ─────────────────────────────────────────────────────────────

_O = {'additionalProperties': False}
_PERIOD = {'month': {'type': 'integer', 'description': '1-12, defaults to this month'}, 'year': {'type': 'integer', 'description': 'defaults to this year'}}
_WHO = {'staff_name': {'type': 'string'}, 'staff_id': {'type': 'integer'},
        'staff_names': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Several people; leave all out for everyone'}}


def _read(name, desc, props, handler, roles=ADMINS):
    register(Tool(name=name, description=desc, parameters={'type': 'object', **_O, 'properties': props},
                  handler=handler, sub_agent='hr', module='hr', roles=roles))


def _write(name, desc, props, propose, revise, apply):
    register(Tool(name=name, description=desc, parameters={'type': 'object', **_O, 'properties': props}, handler=propose,
                  sub_agent='hr', module='hr', roles=ADMINS, kind='write', revise=revise, apply=apply))


_read('get_payroll_summary', 'Payroll totals for a month (basic, allowances, deductions, net) and how many payslips are draft, approved and paid.',
      dict(_PERIOD), get_payroll_summary)
_read('list_payslips', 'Payslips of a month with net pay and status; filter by status or person. Use for "who has not been paid?".',
      {**_PERIOD, 'status': {'type': 'string', 'enum': ['DRAFT', 'APPROVED', 'PAID']}, 'staff_name': {'type': 'string'}, 'staff_id': {'type': 'integer'}}, list_payslips)
_read('get_my_payslip', "The signed-in staff member's own payslip for a month, with the allowance and deduction breakdown.",
      dict(_PERIOD), get_my_payslip, roles=ADMINS + SELF_ROLES)
_read('get_payroll_pending', 'What is left to do for a month: staff without a payslip (and who has no salary set), drafts to approve, approved to pay.',
      dict(_PERIOD), get_payroll_pending)

_write('generate_payslips', 'PREPARE the DRAFT payslips for a month for all active staff who have a salary and no payslip yet. '
       'Staff who already have one are untouched. Nothing is created until the user presses Approve on the card.',
       dict(_PERIOD), generate_payslips, revise_generate, apply_generate)
_write('approve_payslips', 'PREPARE approving DRAFT payslips of a month: everyone, one person, or a list of names. Nothing changes until the user approves the card.',
       {**_PERIOD, **_WHO}, approve_payslips, revise_batch, apply_batch)
_write('mark_payslips_paid', 'PREPARE marking APPROVED payslips as paid (records the payment only; it sends no money). Everyone, one person or a list; '
       'payment_date defaults to today and cannot be in the future. Draft payslips must be approved first. Nothing changes until the user approves the card.',
       {**_PERIOD, **_WHO, 'payment_date': {'type': 'string', 'description': 'YYYY-MM-DD'}}, mark_payslips_paid, revise_batch, apply_batch)
_write('delete_draft_payslips', 'PREPARE deleting DRAFT payslips of a month (approved or paid ones are never deleted). Nothing is deleted until the user approves the card.',
       {**_PERIOD, **_WHO}, delete_draft_payslips, revise_batch, apply_batch)
