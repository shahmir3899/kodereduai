"""Aura tools for the fee system of 2026-11-26: optional (enrolled-only) fees, fee generation, the
per-fee breakdown and fee vouchers.

Reads answer at once. Writes PREPARE an approval card first (same propose -> approve flow as every
other agent write) and, once approved, call the app's own views, so the same permissions, period
locks and validation apply as when a person clicks the button. Cards use the generic three-column
layout ('edit_entry') so the web and phone apps draw them without changes.
"""
import calendar
from decimal import Decimal, InvalidOperation

from django.utils import timezone

from ..internal_api import call
from ..registry import ADMINS, FINANCE_ROLES, ProposalError, Tool, register
from . import lms_common as lc
from .fee_lookup import label as fee_label, resolve_fee_types
from .student_tools import _fail, _year_id, resolve_student

_O = {'additionalProperties': False}
_DATE = {'type': 'string', 'description': 'YYYY-MM-DD'}


def _money(value):
    return f'{Decimal(value or 0):,.0f}'


def _price(value, what='price'):
    if value in (None, ''):
        return None
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ProposalError(f'The {what} must be a number.')
    if amount < 0:
        raise ProposalError(f'The {what} cannot be negative.')
    return amount


def _card(title, summary, columns, rows, warnings=None, **totals):
    return {'kind': 'edit_entry', 'title': title, 'summary': summary, 'columns': columns, 'rows': rows,
            'totals': {'count': len(rows), **totals}, 'warnings': warnings or [], 'editable': {}}


def _period(month, year):
    today = timezone.localdate()
    month = int(month or today.month)
    year = int(year or today.year)
    if not 1 <= month <= 12:
        raise ProposalError('The month must be 1 to 12.')
    return month, year


def _scope(ctx, class_name):
    """{} for the whole school, else the section or master class the user named."""
    if not class_name:
        return {}, 'every class'
    from .directory import find_class
    matches = find_class(ctx, class_name)['matches']
    if not matches:
        raise ProposalError(f'No class matching "{class_name}".')
    best = [m for m in matches if lc.tokens(m['label']) == lc.tokens(class_name)] or matches
    if len(best) > 1 and best[0]['label'].lower() != class_name.strip().lower():
        raise ProposalError('Several classes match: ' + ', '.join(m['label'] for m in best[:8]) + '. Ask which one.')
    m = best[0]
    if m['section_id']:
        return {'session_class_id': m['section_id'], 'class_id': m['class_id']}, m['label']
    return {'class_id': m['class_id']}, m['label']


def _optional_fee(ctx, fee_name):
    fee_types = resolve_fee_types(ctx.school_id, fee_name)
    if len(fee_types) != 1:
        raise ProposalError('Name one optional fee.')
    kind, cat = fee_types[0]
    if cat.billing_mode != 'ENROLLED':
        raise ProposalError(f'{cat.name} is paid by every student, so there is nothing to enroll in. '
                            'It can be made "enrolled students only" in Fee Setup, or create a new optional fee.')
    return kind, cat


# ── reads ────────────────────────────────────────────────────────────────────

def list_optional_fees(ctx):
    from finance.models import StudentFeeEnrollment
    from .fee_lookup import all_fee_types

    today = timezone.localdate()
    out = []
    for kind, c in all_fee_types(ctx.school_id):
        if c.billing_mode != 'ENROLLED':
            continue
        current = StudentFeeEnrollment.objects.filter(
            school_id=ctx.school_id, **({'monthly_category': c} if kind == 'MONTHLY' else {'annual_category': c}),
            start_date__lte=today).exclude(end_date__lt=today).select_related('student')
        out.append({'fee': c.name, 'charged': 'every month' if kind == 'MONTHLY' else 'once a year',
                    'price': float(c.default_amount) if c.default_amount is not None else 'per class (Fee Setup)',
                    'enrolled_count': current.count(),
                    'students': [{'name': e.student.name, 'own_price': float(e.amount) if e.amount is not None else None} for e in current[:40]]})
    return {'optional_fees': out, 'note': 'Only enrolled students are billed for these; joining mid-month is a full month.'}


def get_fee_breakdown(ctx, student_id=None, student_name=None, student_class=None, month=None, year=None):
    from finance.views import FeeBreakdownView

    st = resolve_student(ctx, student_id, student_name, student_class)
    month, year = _period(month, year)
    code, body = call(ctx.user, ctx.school_id, FeeBreakdownView, None, 'get', f'/api/finance/fee-breakdown/{st.id}/',
                      {'year': year, 'month': month}, student_id=st.id)
    if code != 200:
        return {'error': _fail(body, 'The fee breakdown could not be read.')}
    return {'student': st.name, 'month': calendar.month_name[month], 'year': year, 'fees': [
        {'fee': f['category_name'], 'fee_type': f['fee_type'], 'full_fee': float(f['gross']), 'discount': float(f['discount']),
         'charged': float(f['net']), 'discounts': [d['name'] for d in f['discounts']]} for f in body['fees']],
        'monthly_total_charged': float(body['final_amount']) if body.get('final_amount') is not None else None,
        'note': 'Only fees the student pays are listed: an optional fee appears only if they are enrolled that month.'}


def get_fee_vouchers(ctx, month=None, year=None, class_name=None, student_id=None, student_name=None, student_class=None, due_date=None):
    from finance.views import FeePaymentViewSet

    month, year = _period(month, year)
    params, where = _scope(ctx, class_name)
    params.update({'month': month, 'year': year, 'format': 'json', 'academic_year': _year_id(ctx)})
    if student_id or student_name:
        params['student_ids'] = str(resolve_student(ctx, student_id, student_name, student_class).id)
    if due_date:
        params['due_date'] = lc.parse_date(due_date, 'due_date').isoformat()
    code, body = call(ctx.user, ctx.school_id, FeePaymentViewSet, {'get': 'vouchers'}, 'get', '/api/finance/fee-payments/vouchers/', params)
    if code != 200:
        return {'error': _fail(body, 'The vouchers could not be prepared.')}
    return {
        'month': calendar.month_name[month], 'year': year, 'scope': where, 'vouchers': body['count'],
        'first': [{'student': v['student_name'], 'class': v['class_label'], 'due_date': v['due_date'], 'lines': v['lines'],
                   'previous_unpaid': v['previous_unpaid'], 'discount': v['discount'], 'total_payable': v['total_payable']} for v in body['vouchers']],
        'how_to_print': 'Print or share the PDF from Collect Payments > Print Vouchers (web) or Fee Collection > vouchers (phone): '
                        'A4, 3 students per page, school copy and student copy.',
    }


# ── writes: optional fees ────────────────────────────────────────────────────

def create_optional_fee(ctx, name=None, charged=None, price=None):
    from finance.models import AnnualFeeCategory, MonthlyFeeCategory

    name = (name or '').strip()
    if not name:
        raise ProposalError('What is the fee called (e.g. Koder Kids)? Ask the user.')
    kind = 'ANNUAL' if str(charged or 'monthly').lower().startswith(('ann', 'year', 'once')) else 'MONTHLY'
    model = MonthlyFeeCategory if kind == 'MONTHLY' else AnnualFeeCategory
    if model.objects.filter(school_id=ctx.school_id, name__iexact=name).exists():
        raise ProposalError(f'There is already a {kind.lower()} fee called {name}. To make it optional, change it in Fee Setup.')
    amount = _price(price)
    payload = {'kind': 'edit_entry', 'op': 'create_optional', 'name': name, 'fee_kind': kind, 'price': str(amount) if amount is not None else None,
               'args': {'name': name, 'charged': charged, 'price': str(amount) if amount is not None else None}}
    return {'payload': payload, 'preview': _card('New optional fee', name, ['Field', 'From', 'To'], [
        {'field': 'Name', 'from': '', 'to': name},
        {'field': 'Charged', 'from': '', 'to': 'every month' if kind == 'MONTHLY' else 'once a year'},
        {'field': 'Who pays', 'from': '', 'to': 'enrolled students only'},
        {'field': 'Price', 'from': '', 'to': f'Rs {_money(amount)}' if amount is not None else 'set per class in Fee Setup'},
    ], ['Nobody is billed until students are enrolled in it.'])}


def _students_for(ctx, student_names, class_name):
    from academic_sessions.roster import filter_students_in_scope
    from students.models import Student

    names = [n.strip() for n in str(student_names or '').split(',') if n.strip()]
    if names:
        return [resolve_student(ctx, None, n, class_name) for n in names]
    if not class_name:
        raise ProposalError('Which students: names, or a whole class? Ask the user.')
    scope, _ = _scope(ctx, class_name)
    qs = filter_students_in_scope(Student.objects.filter(school_id=ctx.school_id, is_active=True), ctx.school_id,
                                  academic_year_id=_year_id(ctx), session_class_id=scope.get('session_class_id'),
                                  class_obj_id=scope.get('class_id'))
    students = list(qs.order_by('name'))
    if not students:
        raise ProposalError(f'No students found in {class_name}.')
    return students


def enroll_in_optional_fee(ctx, fee_name=None, student_names=None, class_name=None, start_date=None, own_price=None):
    from finance import optional_fees

    kind, cat = _optional_fee(ctx, fee_name)
    start = lc.parse_date(start_date, 'start_date') if start_date else timezone.localdate()
    amount = _price(own_price, 'own price')
    rows, ids, skipped = [], [], []
    for st in _students_for(ctx, student_names, class_name):
        if optional_fees.overlapping_enrollment(ctx.school_id, st.id, cat, start, None):
            skipped.append(st.name)
            continue
        ids.append(st.id)
        rows.append({'field': st.name, 'from': 'not enrolled',
                     'to': f'from {start:%d %b %Y}, ' + (f'Rs {_money(amount)}' if amount is not None else 'normal price')})
    if not ids:
        raise ProposalError(f'Everyone named is already enrolled in {cat.name}.')
    warnings = ['Joining mid-month is charged the full month. Months already generated are not changed.']
    if skipped:
        warnings.append('Already enrolled, left out: ' + ', '.join(skipped[:10]))
    payload = {'kind': 'edit_entry', 'op': 'enroll', 'fee_kind': kind, 'category_id': cat.id, 'student_ids': ids,
               'start_date': start.isoformat(), 'amount': str(amount) if amount is not None else None,
               'args': {'fee_name': fee_name, 'student_names': student_names, 'class_name': class_name, 'start_date': start.isoformat(),
                        'own_price': str(amount) if amount is not None else None}}
    return {'payload': payload, 'preview': _card(f'Enroll in {cat.name}', f'{len(ids)} student{"s" if len(ids) != 1 else ""}',
                                                 ['Student', 'Now', 'After'], rows, warnings)}


def end_optional_fee(ctx, fee_name=None, student_names=None, class_name=None, end_date=None):
    from finance.models import StudentFeeEnrollment

    kind, cat = _optional_fee(ctx, fee_name)
    end = lc.parse_date(end_date, 'end_date') if end_date else timezone.localdate()
    students = _students_for(ctx, student_names, class_name)
    current = {e.student_id: e for e in StudentFeeEnrollment.objects.filter(
        school_id=ctx.school_id, **({'monthly_category': cat} if kind == 'MONTHLY' else {'annual_category': cat}),
        student_id__in=[s.id for s in students]).exclude(end_date__lt=end)}
    rows = [{'field': s.name, 'from': f'enrolled since {current[s.id].start_date:%d %b %Y}', 'to': f'ends {end:%d %b %Y}'}
            for s in students if s.id in current and current[s.id].start_date <= end]
    if not rows:
        raise ProposalError(f'None of them is enrolled in {cat.name} on that date.')
    payload = {'kind': 'edit_entry', 'op': 'end', 'ids': [current[s.id].id for s in students if s.id in current and current[s.id].start_date <= end],
               'end_date': end.isoformat(), 'fee': cat.name,
               'args': {'fee_name': fee_name, 'student_names': student_names, 'class_name': class_name, 'end_date': end.isoformat()}}
    return {'payload': payload, 'preview': _card(f'End {cat.name}', f'{len(rows)} student{"s" if len(rows) != 1 else ""}',
                                                 ['Student', 'Now', 'After'], rows, ['Months after the end date are not billed. Bills already made stay.'])}


# ── writes: fee generation ───────────────────────────────────────────────────

def generate_fees(ctx, fee_names=None, month=None, year=None, class_name=None, update_existing=None):
    from finance.generation_planner import build_preview_plan
    from students.models import Student

    month, year = _period(month, year)
    # No fee named = every monthly fee (the usual monthly run); annual fees are named or asked for.
    fee_types = resolve_fee_types(ctx.school_id, fee_names or 'all', kind=None if fee_names else 'MONTHLY')
    kinds = {k for k, _ in fee_types}
    if len(kinds) > 1:
        raise ProposalError('Monthly and annual fees are generated separately. Ask which: '
                            + ', '.join(f'{c.name} ({k.lower()})' for k, c in fee_types))
    kind = kinds.pop()
    scope, where = _scope(ctx, class_name)
    ay = _year_id(ctx)
    from academic_sessions.roster import filter_students_in_scope
    students = filter_students_in_scope(Student.objects.filter(school_id=ctx.school_id, is_active=True), ctx.school_id,
                                        academic_year_id=ay, session_class_id=scope.get('session_class_id'),
                                        class_obj_id=scope.get('class_id'), year=year, month=month if kind == 'MONTHLY' else None)
    ids = [c.id for _, c in fee_types]
    plan = build_preview_plan(school_id=ctx.school_id, students=students, fee_type=kind, year=year, month=month if kind == 'MONTHLY' else 0,
                              monthly_category_ids=ids if kind == 'MONTHLY' else None,
                              annual_category_ids=ids if kind == 'ANNUAL' else None, academic_year_id=ay)
    rows = []
    for c in plan.get('categories', []):
        who = f"{c['enrolled']} of {c['in_scope']} students enrolled" if c['billing_mode'] == 'ENROLLED' else f"all {c['in_scope']} students"
        made = f"{c['will_create']} new, Rs {_money(c['total_amount'])}"
        if c['already_exist']:
            made += f", {c['already_exist']} already exist"
        rows.append({'field': c['name'], 'from': who, 'to': made})
    if not plan['will_create'] and not (update_existing and plan['already_exist']):
        raise ProposalError(f'Nothing to generate: {plan["already_exist"]} records already exist'
                            + (f', {plan["no_fee_structure"]} students have no price set' if plan['no_fee_structure'] else '') + '.')
    warnings = ['Unpaid balances from earlier months are carried into each monthly record.'] if kind == 'MONTHLY' else []
    if plan['no_fee_structure']:
        warnings.append(f'{plan["no_fee_structure"]} student-fee pairs have no price set and are skipped.')
    if update_existing:
        warnings.append('Existing unpaid records are recalculated (for example to apply a new discount); records with payments are protected.')
    when = f'{calendar.month_name[month]} {year}' if kind == 'MONTHLY' else str(year)
    payload = {'kind': 'edit_entry', 'op': 'generate', 'fee_kind': kind, 'category_ids': ids, 'month': month, 'year': year,
               'scope': scope, 'academic_year': ay, 'conflict': 'update' if update_existing else 'skip',
               'args': {'fee_names': fee_names, 'month': month, 'year': year, 'class_name': class_name, 'update_existing': update_existing}}
    return {'payload': payload, 'preview': _card(f'Generate {kind.lower()} fees', f'{when}, {where}', ['Fee', 'Who pays', 'Will create'], rows, warnings,
                                                 records=plan['will_create'], amount=float(plan['total_amount']))}


# ── writes: voucher settings ─────────────────────────────────────────────────

def set_voucher_settings(ctx, due_day=None, bank_account_name=None, note=None):
    from finance.models import Account
    from schools.models import School

    school = School.objects.get(id=ctx.school_id)
    cfg = school.finance_config or {}
    rows, data = [], {}
    if due_day is not None:
        day = int(due_day)
        if not 1 <= day <= 28:
            raise ProposalError('The due day must be 1 to 28.')
        rows.append({'field': 'Due day', 'from': str(cfg.get('due_day', 10)), 'to': str(day)})
        data['due_day'] = day
    if bank_account_name is not None:
        banks = list(Account.objects.filter(school_id=ctx.school_id, is_active=True, account_type='BANK'))
        want = lc.tokens(bank_account_name)
        hits = [a for a in banks if all(w in lc.tokens(a.name) for w in want)]
        if len(hits) != 1:
            raise ProposalError('Which bank account? Available: ' + (', '.join(a.name for a in banks) or 'none (add one under Accounts)'))
        old = next((a.name for a in banks if a.id == cfg.get('voucher_bank_account_id')), 'none')
        rows.append({'field': 'Bank account on vouchers', 'from': old, 'to': hits[0].name})
        data['voucher_bank_account_id'] = hits[0].id
    if note is not None:
        if len(note) > 150:
            raise ProposalError('The note must be 150 characters or fewer.')
        rows.append({'field': 'Note on vouchers', 'from': cfg.get('voucher_note') or '', 'to': note})
        data['voucher_note'] = note
    if not rows:
        raise ProposalError('What should change: due day, bank account or note? Ask the user.')
    return {'payload': {'kind': 'edit_entry', 'op': 'voucher_settings', 'data': data,
                        'args': {'due_day': due_day, 'bank_account_name': bank_account_name, 'note': note}},
            'preview': _card('Voucher settings', school.name, ['Field', 'From', 'To'], rows,
                             ['The due day is also used for Kuickpay bills.'] if 'due_day' in data else [])}


# ── apply (after the user approves) ──────────────────────────────────────────

def revise(ctx, payload, edits):
    # Cards have nothing editable; a revise re-reads the database by preparing the same request again.
    propose = {'create_optional': create_optional_fee, 'enroll': enroll_in_optional_fee, 'end': end_optional_fee,
               'generate': generate_fees, 'voucher_settings': set_voucher_settings}[payload['op']]
    return propose(ctx, **payload.get('args', {}))


def apply(ctx, payload):
    from finance.views import (
        AnnualFeeCategoryViewSet, FeePaymentViewSet, FeeVoucherSettingsView, MonthlyFeeCategoryViewSet, StudentFeeEnrollmentViewSet,
    )

    op = payload['op']
    if op == 'create_optional':
        monthly = payload['fee_kind'] == 'MONTHLY'
        view = MonthlyFeeCategoryViewSet if monthly else AnnualFeeCategoryViewSet
        path = '/api/finance/monthly-categories/' if monthly else '/api/finance/annual-categories/'
        code, body = call(ctx.user, ctx.school_id, view, {'post': 'create'}, 'post', path,
                          {'name': payload['name'], 'billing_mode': 'ENROLLED', 'default_amount': payload['price']})
        ok = code in (200, 201)
    elif op == 'enroll':
        field = 'monthly_category' if payload['fee_kind'] == 'MONTHLY' else 'annual_category'
        code, body = call(ctx.user, ctx.school_id, StudentFeeEnrollmentViewSet, {'post': 'bulk_enroll'}, 'post',
                          '/api/finance/fee-enrollments/bulk_enroll/',
                          {field: payload['category_id'], 'student_ids': payload['student_ids'], 'start_date': payload['start_date'],
                           'amount': payload['amount'], 'academic_year': _year_id(ctx)})
        ok = code in (200, 201)
    elif op == 'end':
        code, body = call(ctx.user, ctx.school_id, StudentFeeEnrollmentViewSet, {'post': 'end'}, 'post', '/api/finance/fee-enrollments/end/',
                          {'ids': payload['ids'], 'end_date': payload['end_date']})
        ok = code == 200
    elif op == 'generate':
        data = {**payload['scope'], 'year': payload['year'], 'academic_year': payload['academic_year'], 'conflict_strategy': payload['conflict']}
        if payload['fee_kind'] == 'MONTHLY':
            data.update({'month': payload['month'], 'monthly_category_ids': payload['category_ids']})
            action, path = 'generate_monthly', '/api/finance/fee-payments/generate_monthly/'
        else:
            data.update({'annual_category_ids': payload['category_ids']})
            action, path = 'generate_annual_fees', '/api/finance/fee-payments/generate_annual_fees/'
        code, body = call(ctx.user, ctx.school_id, FeePaymentViewSet, {'post': action}, 'post', path, data)
        ok = code in (200, 201, 202)
    elif op == 'voucher_settings':
        code, body = call(ctx.user, ctx.school_id, FeeVoucherSettingsView, None, 'put', '/api/finance/voucher-settings/', payload['data'])
        ok = code == 200
    else:
        return {'ok': False, 'error': 'Unknown change.'}
    if not ok:
        return {'ok': False, 'error': _fail(body, 'The change could not be saved.')}
    out = {'ok': True}
    if isinstance(body, dict):
        for key in ('created', 'skipped', 'ended', 'message', 'id'):
            if key in body:
                out[key] = body[key]
        if isinstance(body.get('result'), dict):
            out['result'] = {k: body['result'].get(k) for k in ('created', 'updated', 'skipped', 'not_enrolled', 'no_fee_structure')}
    return out


# ── registration ─────────────────────────────────────────────────────────────

def _read(name, desc, props, handler):
    register(Tool(name=name, description=desc, parameters={'type': 'object', **_O, 'properties': props}, handler=handler,
                  sub_agent='finance', module='finance', roles=FINANCE_ROLES))


def _write(name, desc, props, propose):
    register(Tool(name=name, description=desc, parameters={'type': 'object', **_O, 'properties': props}, handler=propose,
                  sub_agent='finance', module='finance', roles=ADMINS, kind='write', revise=revise, apply=apply))


_WHO = {'student_id': {'type': 'integer'}, 'student_name': {'type': 'string'}, 'student_class': {'type': 'string'}}
_MONTH = {'month': {'type': 'integer', 'description': '1-12, default this month'}, 'year': {'type': 'integer'}}

_read('list_optional_fees', 'Optional fees (Robotics, Karate, Koder Kids, bus...) that only enrolled students pay: price, how often, '
      'how many and which students are enrolled.', {}, list_optional_fees)
_read('get_fee_breakdown', "One student's fees for a month, per fee: full fee, discount taken off (and which), and what is charged.",
      {**_WHO, **_MONTH}, get_fee_breakdown)
_read('get_fee_vouchers', 'Fee vouchers for a month (a class, a student or the whole school): how many, due date, and the first ones '
      '(fees, previous unpaid, discount, total). Says where to print the A4 PDF.',
      {**_MONTH, 'class_name': {'type': 'string'}, **_WHO, 'due_date': _DATE}, get_fee_vouchers)

_write('create_optional_fee', 'PREPARE a new optional fee that only enrolled students pay (e.g. Koder Kids, Rs 1500 a month). '
       'Nothing is saved until the user approves.',
       {'name': {'type': 'string'}, 'charged': {'type': 'string', 'enum': ['monthly', 'annual']},
        'price': {'type': 'number', 'description': 'One price for every enrolled student'}}, create_optional_fee)
_write('enroll_in_optional_fee', 'PREPARE enrolling students in an optional fee: by names (comma-separated) or a whole class, from a start date, '
       'optionally at their own price. Nothing is saved until the user approves.',
       {'fee_name': {'type': 'string'}, 'student_names': {'type': 'string'}, 'class_name': {'type': 'string'}, 'start_date': _DATE,
        'own_price': {'type': 'number'}}, enroll_in_optional_fee)
_write('end_optional_fee', 'PREPARE ending students\' enrollment in an optional fee (they stop being billed after the end date). '
       'Nothing is saved until the user approves.',
       {'fee_name': {'type': 'string'}, 'student_names': {'type': 'string'}, 'class_name': {'type': 'string'}, 'end_date': _DATE}, end_optional_fee)
_write('generate_fees', 'PREPARE generating fee records for a month (monthly fees) or year (annual fees), for named fees or all, for the '
       'whole school or one class. The card shows per fee how many records and the total, and for optional fees how many are enrolled. '
       'Set update_existing to recalculate unpaid records already made. Nothing is created until the user approves.',
       {'fee_names': {'type': 'string', 'description': 'Comma-separated fee names, or "all" (default all monthly)'}, **_MONTH,
        'class_name': {'type': 'string'}, 'update_existing': {'type': 'boolean'}}, generate_fees)
_write('set_voucher_settings', 'PREPARE changing the school\'s fee voucher settings: due day of the month, bank account printed, note. '
       'Nothing is saved until the user approves.',
       {'due_day': {'type': 'integer'}, 'bank_account_name': {'type': 'string'}, 'note': {'type': 'string'}}, set_voucher_settings)
