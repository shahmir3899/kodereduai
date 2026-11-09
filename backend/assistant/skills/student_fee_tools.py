"""A student's fees through Aura (owner decision 2026-11-08): the monthly fee override, discounts / scholarships, and the amount of one
pending month. Admins and principal only, through FeeStructureViewSet / StudentDiscountViewSet / FeePaymentViewSet as the signed-in user,
so closed-month locks, Kuickpay protection and the app's own validation apply. Writes only PROPOSE; a person presses Approve.

Never touched from here: paid records, months with money already received, class-level fee structures, bulk fee generation.
"""
from decimal import Decimal, InvalidOperation

from django.utils import timezone

from ..internal_api import call
from ..registry import ADMINS, ProposalError, Tool, register
from . import lms_common as lc
from .student_tools import _WHO, _fail, _items, _year_id, resolve_student

MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']


def _amount(value, what='amount'):
    try:
        d = Decimal(str(value))
    except (InvalidOperation, TypeError):
        raise ProposalError(f'"{value}" is not a valid {what}.')
    if d < 0:
        raise ProposalError(f'The {what} cannot be negative.')
    return d


def _m(d):
    return f'{float(d):,.0f}'


# ── reads ────────────────────────────────────────────────────────────────────

def list_discounts(ctx):
    from finance.models import Discount, Scholarship

    year = _year_id(ctx)
    ds = [{'type': 'discount', 'id': d.id, 'name': d.name, 'kind': d.discount_type, 'value': float(d.value)}
          for d in Discount.objects.filter(school_id=ctx.school_id, is_active=True, academic_year_id=year)]
    ss = [{'type': 'scholarship', 'id': s.id, 'name': s.name, 'kind': s.scholarship_type, 'value': float(s.value)}
          for s in Scholarship.objects.filter(school_id=ctx.school_id, is_active=True, academic_year_id=year)]
    return {'discounts': ds, 'scholarships': ss}


def get_student_fees(ctx, student_id=None, student_name=None, student_class=None):
    from finance.models import FeePayment

    st = resolve_student(ctx, student_id, student_name, student_class)
    rows = FeePayment.objects.filter(school_id=ctx.school_id, student=st).order_by('-year', '-month', 'fee_type')[:24]
    return {'student': st.name, 'student_id': st.id, 'records': [
        {'fee': r.fee_type, 'month': MONTHS[r.month] if r.month else None, 'year': r.year, 'due': float(r.amount_due), 'paid': float(r.amount_paid or 0),
         'status': r.status} for r in rows]}


# ── monthly fee override ─────────────────────────────────────────────────────

def _active_overrides(ctx, st):
    from finance.models import FeeStructure
    return list(FeeStructure.objects.filter(school_id=ctx.school_id, student=st, fee_type='MONTHLY', is_active=True))


def _build_override(ctx, payload):
    from students.models import Student

    st = Student.objects.filter(school_id=ctx.school_id, id=payload['student_id']).first()
    if st is None:
        raise ProposalError('That student no longer exists.')
    old = _active_overrides(ctx, st)
    was = f"Rs {_m(old[0].monthly_amount)}" if old else 'class fee'
    if payload['mode'] == 'clear':
        if not old:
            raise ProposalError(f'{st.name} has no monthly fee override; the class fee already applies.')
        rows = [{'field': 'Monthly fee', 'from': was, 'to': 'class fee'}]
        title, summary = 'Remove monthly fee override', f'{st.name}: back to the class fee'
        warnings = ['Fee records already generated keep their amounts.']
    else:
        amount = _amount(payload['amount'], 'monthly fee')
        if old and old[0].monthly_amount == amount:
            raise ProposalError(f'{st.name} already has a monthly fee of Rs {_m(amount)}.')
        rows = [{'field': 'Monthly fee', 'from': was, 'to': f'Rs {_m(amount)}'}, {'field': 'From', 'from': '', 'to': payload['effective_from']}]
        title, summary = 'Set monthly fee override', f'{st.name}: monthly fee Rs {_m(amount)}'
        warnings = ['Fee records already generated keep their amounts; change a pending month separately if needed.']
        if len(old) > 1:
            warnings.append(f'{len(old)} existing overrides are replaced.')
    return {'payload': payload, 'preview': {
        'kind': 'edit_entry', 'title': title, 'summary': summary, 'columns': ['Field', 'From', 'To'], 'rows': rows,
        'totals': {'count': 1}, 'warnings': warnings, 'editable': {}}}


def set_student_monthly_fee(ctx, amount=None, student_id=None, student_name=None, student_class=None, effective_from=None):
    st = resolve_student(ctx, student_id, student_name, student_class)
    if amount is None:
        raise ProposalError('What monthly fee amount? Ask the user.')
    return _build_override(ctx, {'kind': 'edit_entry', 'mode': 'set', 'student_id': st.id, 'amount': str(_amount(amount, 'monthly fee')),
                                 'effective_from': (lc.parse_date(effective_from, 'effective_from') if effective_from else timezone.localdate()).isoformat()})


def clear_student_monthly_fee(ctx, student_id=None, student_name=None, student_class=None):
    st = resolve_student(ctx, student_id, student_name, student_class)
    return _build_override(ctx, {'kind': 'edit_entry', 'mode': 'clear', 'student_id': st.id})


def revise_override(ctx, payload, edits):
    return _build_override(ctx, payload)


def apply_override(ctx, payload):
    from finance.views import FeeStructureViewSet
    from students.models import Student

    st = Student.objects.get(pk=payload['student_id'])
    if payload['mode'] == 'clear':
        for fs in _active_overrides(ctx, st):
            s, body = call(ctx.user, ctx.school_id, FeeStructureViewSet, {'delete': 'destroy'}, 'delete', f'/api/finance/fee-structures/{fs.id}/', pk=fs.id)
            if s not in (200, 204):
                return {'ok': False, 'error': _fail(body, 'The override could not be removed.')}
        return {'ok': True}
    data = {'class_id': st.class_obj_id, 'fee_type': 'MONTHLY', 'effective_from': payload['effective_from'],
            'students': [{'student_id': st.id, 'monthly_amount': payload['amount']}]}
    s, body = call(ctx.user, ctx.school_id, FeeStructureViewSet, {'post': 'bulk_set_students'}, 'post', '/api/finance/fee-structures/bulk_set_students/', data)
    if s not in (200, 201):
        return {'ok': False, 'error': _fail(body, 'The fee could not be saved.')}
    return {'ok': True, 'created': (body or {}).get('created')}


# ── discounts / scholarships ─────────────────────────────────────────────────

def _find_discount(ctx, name):
    from finance.models import Discount, Scholarship

    year = _year_id(ctx)
    want = lc.tokens(name)
    if not want:
        raise ProposalError('Which discount or scholarship? Ask the user.')
    pool = [('discount', d) for d in Discount.objects.filter(school_id=ctx.school_id, is_active=True, academic_year_id=year)] + \
           [('scholarship', s) for s in Scholarship.objects.filter(school_id=ctx.school_id, is_active=True, academic_year_id=year)]
    hits = [(k, o) for k, o in pool if all(w in lc.tokens(o.name) for w in want)]
    if not hits:
        raise ProposalError(f'No active discount or scholarship called "{name}" this year. Available: ' + (', '.join(o.name for _, o in pool) or 'none'))
    if len(hits) > 1:
        raise ProposalError('Several match: ' + ', '.join(o.name for _, o in hits) + '. Ask which.')
    return hits[0]


def _assigned(ctx, st, kind, obj):
    from finance.models import StudentDiscount
    return StudentDiscount.objects.filter(school_id=ctx.school_id, student=st, is_active=True, **{f'{kind}_id': obj.id})


def _build_discount(ctx, payload):
    from finance.models import Discount, Scholarship
    from students.models import Student

    st = Student.objects.filter(school_id=ctx.school_id, id=payload['student_id']).first()
    model = Discount if payload['kind'] == 'discount' else Scholarship
    obj = model.objects.filter(school_id=ctx.school_id, id=payload['item_id']).first()
    if st is None or obj is None:
        raise ProposalError('The student or the discount no longer exists.')
    have = _assigned(ctx, st, payload['kind'], obj).exists()
    value = f"{float(obj.value):g}" + ('%' if getattr(obj, 'discount_type', '') == 'PERCENTAGE' or getattr(obj, 'scholarship_type', '') == 'PERCENTAGE' else '')
    if payload['mode'] == 'assign':
        if have:
            raise ProposalError(f'{st.name} already has {obj.name}.')
        rows = [{'field': obj.name, 'from': 'not assigned', 'to': f'assigned ({value})'}]
        title, warnings = 'Assign discount', ['The discount applies when fees are generated or recalculated; existing fee records are not rewritten from here.']
    else:
        if not have:
            raise ProposalError(f'{st.name} does not have {obj.name}.')
        rows = [{'field': obj.name, 'from': f'assigned ({value})', 'to': 'removed'}]
        title, warnings = 'Remove discount', ['Existing fee records keep the amounts they already have.']
    return {'payload': payload, 'preview': {
        'kind': 'edit_entry', 'title': title, 'summary': f'{st.name}: {obj.name}', 'columns': ['Field', 'From', 'To'], 'rows': rows,
        'totals': {'count': 1}, 'warnings': warnings, 'editable': {}}}


def assign_student_discount(ctx, discount_name=None, student_id=None, student_name=None, student_class=None, notes=None):
    st = resolve_student(ctx, student_id, student_name, student_class)
    kind, obj = _find_discount(ctx, discount_name)
    return _build_discount(ctx, {'kind': kind, 'mode': 'assign', 'student_id': st.id, 'item_id': obj.id, 'notes': (notes or '')[:200]})


def remove_student_discount(ctx, discount_name=None, student_id=None, student_name=None, student_class=None):
    st = resolve_student(ctx, student_id, student_name, student_class)
    kind, obj = _find_discount(ctx, discount_name)
    return _build_discount(ctx, {'kind': kind, 'mode': 'remove', 'student_id': st.id, 'item_id': obj.id})


def revise_discount(ctx, payload, edits):
    return _build_discount(ctx, payload)


def apply_discount(ctx, payload):
    from finance.models import Discount, Scholarship
    from finance.views import StudentDiscountViewSet

    kind = payload['kind']
    if payload['mode'] == 'remove':
        from students.models import Student
        st = Student.objects.get(pk=payload['student_id'])
        obj = (Discount if kind == 'discount' else Scholarship).objects.get(pk=payload['item_id'])
        for row in _assigned(ctx, st, kind, obj):
            s, body = call(ctx.user, ctx.school_id, StudentDiscountViewSet, {'delete': 'destroy'}, 'delete', f'/api/finance/student-discounts/{row.id}/', pk=row.id)
            if s not in (200, 204):
                return {'ok': False, 'error': _fail(body, 'The discount could not be removed.')}
        return {'ok': True}
    obj = (Discount if kind == 'discount' else Scholarship).objects.get(pk=payload['item_id'])
    data = {'student_id': payload['student_id'], f'{kind}_id': obj.id, 'academic_year_id': obj.academic_year_id, 'notes': payload.get('notes', '')}
    s, body = call(ctx.user, ctx.school_id, StudentDiscountViewSet, {'post': 'create'}, 'post', '/api/finance/student-discounts/', data)
    if s not in (200, 201):
        return {'ok': False, 'error': _fail(body, 'The discount could not be assigned.')}
    return {'ok': True}


# ── one pending month ────────────────────────────────────────────────────────

def _find_month(ctx, st, month, year, fee_type):
    from finance.models import FeePayment

    qs = FeePayment.objects.filter(school_id=ctx.school_id, student=st, fee_type=fee_type, month=month if fee_type == 'MONTHLY' else 0, year=year)
    rows = list(qs.select_related('monthly_category'))
    if not rows:
        raise ProposalError(f'{st.name} has no {fee_type.lower()} fee record for {MONTHS[month] if month else ""} {year}.'.replace('  ', ' '))
    if len(rows) > 1:
        raise ProposalError('Several fee records match: ' + ', '.join(f'{(r.monthly_category.name if r.monthly_category_id else "fee")} (record {r.id})' for r in rows)
                            + '. Ask which, then pass fee_record_id.')
    return rows[0]


def _build_pending(ctx, payload):
    from finance.models import FeePayment

    fp = FeePayment.objects.filter(school_id=ctx.school_id, id=payload['record_id']).select_related('student', 'monthly_category').first()
    if fp is None:
        raise ProposalError('That fee record no longer exists.')
    if fp.status == 'PAID' or (fp.amount_paid or 0) > 0:
        raise ProposalError(f'{fp.student.name}\'s {MONTHS[fp.month]} {fp.year} fee already has a payment on it ({_m(fp.amount_paid or 0)} paid). '
                            'Only a month with nothing paid can be changed from here.')
    new = _amount(payload['new_amount'], 'fee amount')
    if new == fp.amount_due:
        raise ProposalError(f'That month is already Rs {_m(new)}.')
    label = f"{MONTHS[fp.month]} {fp.year}" if fp.month else str(fp.year)
    diff = new - fp.amount_due
    rows = [{'field': f'{fp.fee_type.title()} fee {label}', 'from': f'Rs {_m(fp.amount_due)}', 'to': f'Rs {_m(new)}'},
            {'field': 'Difference', 'from': '', 'to': f"{'+' if diff > 0 else '-'}Rs {_m(abs(diff))}"}]
    return {'payload': {**payload, 'new_amount': str(new)}, 'preview': {
        'kind': 'edit_entry', 'title': 'Change a pending fee', 'summary': f'{fp.student.name}: {label} to Rs {_m(new)}',
        'columns': ['Field', 'From', 'To'], 'rows': rows, 'totals': {'count': 1},
        'warnings': ['Only this one record changes. A closed month is refused by the app.'], 'editable': {}}}


def change_pending_fee(ctx, new_amount=None, month=None, year=None, fee_type=None, fee_record_id=None, student_id=None, student_name=None, student_class=None):
    from finance.models import FeePayment

    if new_amount is None:
        raise ProposalError('What should the new amount be? Ask the user.')
    if fee_record_id:
        fp = FeePayment.objects.filter(school_id=ctx.school_id, id=int(fee_record_id)).first()
        if fp is None:
            raise ProposalError(f'No fee record with id {fee_record_id}.')
    else:
        st = resolve_student(ctx, student_id, student_name, student_class)
        if not month and (fee_type or 'MONTHLY') == 'MONTHLY':
            raise ProposalError('Which month? Ask the user.')
        fp = _find_month(ctx, st, int(month or 0), int(year or timezone.localdate().year), (fee_type or 'MONTHLY').upper())
    return _build_pending(ctx, {'kind': 'edit_entry', 'record_id': fp.id, 'new_amount': str(_amount(new_amount, 'fee amount'))})


def revise_pending(ctx, payload, edits):
    return _build_pending(ctx, payload)


def apply_pending(ctx, payload):
    from finance.views import FeePaymentViewSet

    s, body = call(ctx.user, ctx.school_id, FeePaymentViewSet, {'patch': 'partial_update'}, 'patch', f"/api/finance/fee-payments/{payload['record_id']}/",
                   {'amount_due': payload['new_amount']}, pk=payload['record_id'])
    if s != 200:
        return {'ok': False, 'error': _fail(body, 'The fee could not be changed.')}
    return {'ok': True}


# ── registration ─────────────────────────────────────────────────────────────

_O = {'additionalProperties': False}


def _read(name, desc, props, handler):
    register(Tool(name=name, description=desc, parameters={'type': 'object', **_O, 'properties': props}, handler=handler,
                  sub_agent='students', module='finance', roles=ADMINS))


def _write(name, desc, props, propose, revise, apply):
    register(Tool(name=name, description=desc, parameters={'type': 'object', **_O, 'properties': props}, handler=propose,
                  sub_agent='students', module='finance', roles=ADMINS, kind='write', revise=revise, apply=apply))


_read('list_discounts', 'The discounts and scholarships active this year (name, kind, value) that can be assigned to a student.', {}, list_discounts)
_read('get_student_fees', "One student's fee records (monthly, annual, ...) with due, paid and status, newest first.", dict(_WHO), get_student_fees)

_write('set_student_monthly_fee', "PREPARE a student's own monthly fee (an override of the class fee), e.g. 'Ali ki monthly fee 3000 kar do'. "
       "Existing fee records keep their amounts. Nothing is saved until the user approves.",
       {**_WHO, 'amount': {'type': 'number'}, 'effective_from': {'type': 'string', 'description': 'YYYY-MM-DD, defaults to today'}},
       set_student_monthly_fee, revise_override, apply_override)
_write('clear_student_monthly_fee', "PREPARE removing a student's own monthly fee so the class fee applies again. Nothing changes until the user approves.",
       dict(_WHO), clear_student_monthly_fee, revise_override, apply_override)
_write('assign_student_discount', 'PREPARE giving a student a discount or scholarship by name (see list_discounts). Nothing is saved until the user approves.',
       {**_WHO, 'discount_name': {'type': 'string'}, 'notes': {'type': 'string'}}, assign_student_discount, revise_discount, apply_discount)
_write('remove_student_discount', 'PREPARE removing a discount or scholarship from a student. Nothing changes until the user approves.',
       {**_WHO, 'discount_name': {'type': 'string'}}, remove_student_discount, revise_discount, apply_discount)
_write('change_pending_fee', 'PREPARE changing the amount due on ONE fee record that has nothing paid on it (e.g. "Sara ki November ki fee 2500 kar do"). '
       'Records with any payment are refused. Pass month and year (monthly fees) or fee_record_id. Nothing changes until the user approves.',
       {**_WHO, 'new_amount': {'type': 'number'}, 'month': {'type': 'integer'}, 'year': {'type': 'integer'},
        'fee_type': {'type': 'string', 'enum': ['MONTHLY', 'ANNUAL']}, 'fee_record_id': {'type': 'integer'}},
       change_pending_fee, revise_pending, apply_pending)
