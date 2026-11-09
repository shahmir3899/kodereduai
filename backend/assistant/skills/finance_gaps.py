"""Finance gaps (backlog item G): a student's ledger, receipts, an account's ledger, and discount / scholarship DEFINITIONS.

Reads go through FeePaymentViewSet / AccountViewSet as the signed-in user, so the app's role and tenant rules apply. Writes only PROPOSE a
preview card; a person presses Approve, and the real DiscountViewSet / ScholarshipViewSet (admin only) validate and save.
Assigning a discount to a student already lives in student_fee_tools; deleting a definition is deliberately not offered (students may hold it).
"""
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from django.utils import timezone

from ..internal_api import call
from ..registry import ADMINS, FINANCE_ROLES, ProposalError, Tool, register
from . import lms_common as lc
from .student_fee_tools import MONTHS
from .student_tools import _WHO, _fail, _items, _year_id, resolve_student

LIMIT = 40
_O = {'additionalProperties': False}
_DATE = {'type': 'string', 'description': 'YYYY-MM-DD'}


def _num(value, what):
    try:
        d = Decimal(str(value))
    except (InvalidOperation, TypeError):
        raise ProposalError(f'"{value}" is not a valid {what}.')
    if d < 0:
        raise ProposalError(f'The {what} cannot be negative.')
    return d


def _money(d):
    return float(d or 0)


# ── reads ────────────────────────────────────────────────────────────────────

def _payments(ctx, **params):
    from finance.views import FeePaymentViewSet

    code, body = call(ctx.user, ctx.school_id, FeePaymentViewSet, {'get': 'list'}, 'get', '/api/finance/fee-payments/', {'page_size': 2000, **params})
    if code != 200:
        raise ProposalError(_fail(body, 'Could not read the fee records.'))
    return _items(body)


def get_student_ledger(ctx, student_id=None, student_name=None, student_class=None, all_years=False):
    """Fee records oldest first with a running balance. Billed = received + pending, always."""
    st = resolve_student(ctx, student_id, student_name, student_class)
    params = {'student_id': st.id}
    if not all_years:
        params['academic_year'] = _year_id(ctx)
    rows = sorted(_payments(ctx, **params), key=lambda r: (r.get('year') or 0, r.get('month') or 0, r.get('id') or 0))
    out, running, billed, received = [], Decimal('0'), Decimal('0'), Decimal('0')
    for r in rows:
        due, paid = Decimal(str(r.get('amount_due') or 0)), Decimal(str(r.get('amount_paid') or 0))
        billed, received = billed + due, received + paid
        running += due - paid
        out.append({'period': f"{MONTHS[r['month']]} {r['year']}" if r.get('month') else str(r.get('year')), 'fee': r.get('fee_type'),
                    'due': _money(due), 'paid': _money(paid), 'balance_after': _money(running), 'status': r.get('status'),
                    'paid_on': r.get('payment_date'), 'method': r.get('payment_method') if paid else None, 'receipt': r.get('receipt_number') or None})
    shown = out[-LIMIT:]
    return {'student': st.name, 'student_id': st.id, 'scope': 'all years' if all_years else 'this academic year', 'records': shown,
            'totals': {'billed': _money(billed), 'received': _money(received), 'pending': _money(billed - received)},
            **({'note': f'Showing the latest {LIMIT} of {len(out)} records; totals cover all of them.'} if len(out) > LIMIT else {})}


def get_receipts(ctx, date_from=None, date_to=None, student_id=None, student_name=None, student_class=None, class_name=None, section=None, method=None):
    """Payments received in a date range (default: this month so far), newest first."""
    today = timezone.localdate()
    d1 = lc.parse_date(date_to, 'date_to') if date_to else today
    d0 = lc.parse_date(date_from, 'date_from') if date_from else d1.replace(day=1)
    if d1 < d0:
        raise ProposalError('The end date is before the start date.')
    if (d1 - d0).days > 366:
        raise ProposalError('Please ask for at most one year at a time.')
    base = {'status': ''}
    if student_id or student_name:
        base['student_id'] = resolve_student(ctx, student_id, student_name, student_class).id
    if class_name:
        sections = lc.find_sections(ctx, class_name, section)
        if not sections:
            raise ProposalError(f'No class matching "{class_name}" in the current academic year.')
        if len({s.class_obj_id for s in sections}) > 1:
            raise ProposalError(f'"{class_name}" matches several classes. Ask which one.')
        base['academic_year'] = sections[0].academic_year_id
        if section or len(sections) == 1:
            base['session_class_id'] = sections[0].id
        else:
            base['class_id'] = sections[0].class_obj_id
    seen, rows = set(), []
    for year in sorted({d0.year, d1.year}):
        for r in _payments(ctx, **{k: v for k, v in base.items() if v != ''}, year=year):
            paid_on = r.get('payment_date')
            if r['id'] in seen or not paid_on or Decimal(str(r.get('amount_paid') or 0)) <= 0:
                continue
            if not (d0.isoformat() <= str(paid_on) <= d1.isoformat()):
                continue
            if method and (r.get('payment_method') or '').upper() != method.upper():
                continue
            seen.add(r['id'])
            rows.append(r)
    rows.sort(key=lambda r: (str(r['payment_date']), r['id']), reverse=True)
    by_method = {}
    for r in rows:
        by_method[r.get('payment_method') or '?'] = by_method.get(r.get('payment_method') or '?', Decimal('0')) + Decimal(str(r['amount_paid']))
    total = sum((Decimal(str(r['amount_paid'])) for r in rows), Decimal('0'))
    return {'from': d0.isoformat(), 'to': d1.isoformat(), 'count': len(rows), 'total_received': _money(total),
            'by_method': {k: _money(v) for k, v in by_method.items()},
            'receipts': [{'receipt': r.get('receipt_number') or None, 'date': r['payment_date'], 'student': r.get('student_name'), 'amount': _money(Decimal(str(r['amount_paid']))),
                          'method': r.get('payment_method'), 'account': r.get('account_name'), 'collected_by': r.get('collected_by_name'),
                          'for': r.get('fee_type_display') or r.get('fee_type')} for r in rows[:LIMIT]],
            **({'note': f'Showing the newest {LIMIT} of {len(rows)}; the totals cover all of them.'} if len(rows) > LIMIT else {})}


def get_account_ledger(ctx, account_id=None, account_name=None, date_from=None, date_to=None):
    """Running statement of ONE account: opening, closing, and the newest entries."""
    from finance.views import AccountViewSet
    from .finance_writes import _accounts

    accounts = _accounts(ctx)
    pick = None
    if account_id:
        pick = next((a for a in accounts if a['id'] == int(account_id)), None)
    elif account_name:
        want = lc.tokens(account_name)
        hits = [a for a in accounts if all(w in lc.tokens(a['name']) for w in want)]
        if len(hits) > 1:
            raise ProposalError('Several accounts match: ' + ', '.join(f"{a['name']} (id {a['id']})" for a in hits) + '. Ask which one.')
        pick = hits[0] if hits else None
    elif len(accounts) == 1:
        pick = accounts[0]
    if not pick:
        raise ProposalError('Which account? Accounts: ' + ', '.join(f"{a['name']} (id {a['id']})" for a in accounts))
    params = {'account_id': pick['id'], 'ordering': 'desc', 'limit': LIMIT}
    if date_from:
        params['date_from'] = lc.parse_date(date_from, 'date_from').isoformat()
    if date_to:
        params['date_to'] = lc.parse_date(date_to, 'date_to').isoformat()
    code, body = call(ctx.user, ctx.school_id, AccountViewSet, {'get': 'ledger'}, 'get', '/api/finance/accounts/ledger/', params)
    if code != 200 or not isinstance(body, dict):
        raise ProposalError(_fail(body, 'Could not read the ledger.'))
    entries = [{'date': e.get('date'), 'type': e.get('type'), 'description': e.get('description'), 'reference': e.get('reference') or None,
                'in': _money(e.get('credit')), 'out': _money(e.get('debit')), 'balance': _money(e.get('balance')) if e.get('balance') is not None else None}
               for e in (body.get('entries') or [])]
    return {'account': pick['name'], 'opening_balance': _money(body.get('opening_balance')), 'total_in': _money(body.get('total_credits')),
            'total_out': _money(body.get('total_debits')), 'closing_balance': _money(body.get('closing_balance')), 'entries': entries,
            'note': f'Newest {LIMIT} entries at most; the totals cover the whole range.'}


# ── discount and scholarship definitions ─────────────────────────────────────

DISCOUNT_TYPES = ('PERCENTAGE', 'FIXED')
APPLIES_TO = ('ALL', 'GRADE_LEVEL', 'CLASS', 'SIBLING')
SCHOLARSHIP_TYPES = ('MERIT', 'NEED', 'SPORTS', 'STAFF_CHILD', 'OTHER')
COVERAGES = ('FULL', 'PERCENTAGE', 'FIXED')


def _pick(kind, ctx, name):
    """The ONE current-year discount / scholarship with this name, else a question."""
    from finance.models import Discount, Scholarship

    model = Discount if kind == 'discount' else Scholarship
    pool = list(model.objects.filter(school_id=ctx.school_id, academic_year_id=_year_id(ctx)))
    want = lc.tokens(name)
    hits = [o for o in pool if all(w in lc.tokens(o.name) for w in want)] if want else []
    exact = [o for o in hits if lc.flat(o.name) == lc.flat(name)]
    hits = exact or hits
    if not hits:
        raise ProposalError(f'No {kind} named "{name}" this year. Available: ' + (', '.join(o.name for o in pool[:20]) or 'none yet'))
    if len(hits) > 1:
        raise ProposalError(f'"{name}" matches several {kind}s: ' + ', '.join(f'{o.name} (id {o.id})' for o in hits[:8]) + '. Ask which one.')
    return hits[0]


def _target_class(ctx, class_name):
    from .directory import master_classes_matching

    hits = master_classes_matching(ctx.school_id, class_name)
    if not hits:
        raise ProposalError(f'No class matching "{class_name}".')
    if len(hits) > 1:
        raise ProposalError(f'"{class_name}" matches several classes: ' + ', '.join(c.name for c in hits[:6]) + '. Ask which one.')
    return hits[0]


def _holders(kind, obj):
    from finance.models import StudentDiscount

    qs = StudentDiscount.objects.filter(is_active=True)
    return qs.filter(discount=obj).count() if kind == 'discount' else qs.filter(scholarship=obj).count()


def _clean(kind, ctx, fields, existing=None):
    """Validated field values for the card and the API call. Same rules the app's serializer enforces, so a mistake is caught before the card."""
    out = {}
    if 'name' in fields and fields['name'] is not None:
        if not str(fields['name']).strip():
            raise ProposalError('The name cannot be empty.')
        out['name'] = str(fields['name']).strip()[:100]
    if kind == 'discount':
        if fields.get('discount_type'):
            if fields['discount_type'] not in DISCOUNT_TYPES:
                raise ProposalError('discount_type must be PERCENTAGE or FIXED.')
            out['discount_type'] = fields['discount_type']
        if fields.get('applies_to'):
            if fields['applies_to'] not in APPLIES_TO:
                raise ProposalError('applies_to must be one of: ' + ', '.join(APPLIES_TO) + '. (One student at a time is done with assign_student_discount.)')
            out['applies_to'] = fields['applies_to']
        for key in ('start_date', 'end_date'):
            if fields.get(key):
                out[key] = lc.parse_date(fields[key], key).isoformat()
        if fields.get('target_grade_level') is not None:
            out['target_grade_level'] = int(fields['target_grade_level'])
        if fields.get('class_name'):
            klass = _target_class(ctx, fields['class_name'])
            out['target_class'], out['target_class_name'] = klass.id, klass.name
        if fields.get('max_uses') is not None:
            out['max_uses'] = int(fields['max_uses'])
        if fields.get('stackable') is not None:
            out['stackable'] = bool(fields['stackable'])
        pct = out.get('discount_type', getattr(existing, 'discount_type', None)) == 'PERCENTAGE'
    else:
        for key, allowed in (('scholarship_type', SCHOLARSHIP_TYPES), ('coverage', COVERAGES)):
            if fields.get(key):
                if fields[key] not in allowed:
                    raise ProposalError(f'{key} must be one of: ' + ', '.join(allowed))
                out[key] = fields[key]
        if fields.get('description') is not None:
            out['description'] = str(fields['description'])[:500]
        if fields.get('max_recipients') is not None:
            out['max_recipients'] = int(fields['max_recipients'])
        pct = out.get('coverage', getattr(existing, 'coverage', None)) == 'PERCENTAGE'
    if fields.get('value') is not None:
        value = _num(fields['value'], 'value')
        if pct and value > 100:
            raise ProposalError('A percentage must be between 0 and 100.')
        out['value'] = str(value)
    if fields.get('is_active') is not None:
        out['is_active'] = bool(fields['is_active'])
    # Conditional requirements, on what the record WILL look like.
    if kind == 'discount':
        applies = out.get('applies_to', getattr(existing, 'applies_to', 'ALL'))
        if applies == 'CLASS' and not (out.get('target_class') or getattr(existing, 'target_class_id', None)):
            raise ProposalError('Which class is this discount for? Ask the user.')
        if applies == 'GRADE_LEVEL' and out.get('target_grade_level') is None and getattr(existing, 'target_grade_level', None) is None:
            raise ProposalError('Which grade level is this discount for? Ask the user.')
    return out


LABELS = {'name': 'Name', 'discount_type': 'Type', 'value': 'Value', 'applies_to': 'Applies to', 'target_class_name': 'Class', 'target_grade_level': 'Grade level',
          'start_date': 'From', 'end_date': 'Until', 'max_uses': 'Max uses', 'stackable': 'Stackable', 'is_active': 'Active',
          'scholarship_type': 'Kind', 'coverage': 'Coverage', 'description': 'Description', 'max_recipients': 'Max recipients'}


def _current(kind, obj):
    if obj is None:
        return {}
    keys = ('name', 'discount_type', 'value', 'applies_to', 'target_grade_level', 'start_date', 'end_date', 'max_uses', 'stackable', 'is_active') if kind == 'discount' \
        else ('name', 'scholarship_type', 'coverage', 'value', 'description', 'max_recipients', 'is_active')
    cur = {k: getattr(obj, k) for k in keys}
    if kind == 'discount':
        cur['target_class_name'] = obj.target_class.name if obj.target_class_id else None
    return {k: ('' if v is None else str(v)) for k, v in cur.items()}


def _build(ctx, payload):
    from finance.models import Discount, Scholarship

    kind, mode = payload['item'], payload['mode']
    model = Discount if kind == 'discount' else Scholarship
    existing = model.objects.filter(school_id=ctx.school_id, pk=payload['item_id']).select_related('target_class' if kind == 'discount' else 'school').first() if mode == 'edit' else None
    if mode == 'edit' and existing is None:
        raise ProposalError(f'That {kind} no longer exists.')
    fields = _clean(kind, ctx, payload['fields'], existing)
    if mode == 'create':
        for needed in (('name', 'discount_type', 'value') if kind == 'discount' else ('name', 'scholarship_type', 'coverage')):
            if needed not in fields:
                raise ProposalError(f'The {needed.replace("_", " ")} is required. Ask the user.')
        if kind == 'scholarship' and fields.get('coverage') != 'FULL' and 'value' not in fields:
            raise ProposalError('A percentage or fixed scholarship needs a value. Ask the user.')
        fields.setdefault('value', '0')
    else:
        if not fields:
            raise ProposalError('Nothing to change. Say what should be different.')
    cur = _current(kind, existing)
    rows = []
    for key, new in fields.items():
        if key == 'target_class':
            continue
        label_key = key
        shown = '' if new is None else str(new)
        if cur.get(label_key, '') != shown:
            rows.append({'field': LABELS.get(key, key), 'from': cur.get(label_key, ''), 'to': shown})
    if mode == 'edit' and not rows:
        raise ProposalError(f'The {kind} already has those values.')
    warnings = []
    if mode == 'edit':
        holders = _holders(kind, existing)
        if holders:
            warnings.append(f'{holders} student{"s" if holders != 1 else ""} already have this {kind}; check fee records already generated.')
    name = fields.get('name') or (existing.name if existing else '')
    title = f'{"New" if mode == "create" else "Change"} {kind}'
    return {'payload': {**payload, 'fields': payload['fields']}, 'preview': {
        'kind': 'edit_entry', 'title': title, 'summary': f'{name}', 'columns': ['Field', 'From', 'To'], 'rows': rows,
        'totals': {'count': len(rows)}, 'warnings': warnings, 'editable': {}}}


def _fields(**kw):
    return {k: v for k, v in kw.items() if v is not None}


def create_discount(ctx, name=None, discount_type=None, value=None, applies_to=None, class_name=None, grade_level=None, start_date=None, end_date=None,
                    max_uses=None, stackable=None):
    return _build(ctx, {'kind': 'edit_entry', 'item': 'discount', 'mode': 'create', 'item_id': None, 'fields': _fields(
        name=name, discount_type=discount_type, value=value, applies_to=applies_to or 'ALL', class_name=class_name, target_grade_level=grade_level,
        start_date=start_date, end_date=end_date, max_uses=max_uses, stackable=stackable)})


def edit_discount(ctx, discount_name=None, name=None, discount_type=None, value=None, applies_to=None, class_name=None, grade_level=None, start_date=None,
                  end_date=None, max_uses=None, stackable=None, is_active=None):
    obj = _pick('discount', ctx, discount_name or '')
    return _build(ctx, {'kind': 'edit_entry', 'item': 'discount', 'mode': 'edit', 'item_id': obj.id, 'fields': _fields(
        name=name, discount_type=discount_type, value=value, applies_to=applies_to, class_name=class_name, target_grade_level=grade_level,
        start_date=start_date, end_date=end_date, max_uses=max_uses, stackable=stackable, is_active=is_active)})


def create_scholarship(ctx, name=None, scholarship_type=None, coverage=None, value=None, description=None, max_recipients=None):
    return _build(ctx, {'kind': 'edit_entry', 'item': 'scholarship', 'mode': 'create', 'item_id': None, 'fields': _fields(
        name=name, scholarship_type=scholarship_type, coverage=coverage, value=value, description=description, max_recipients=max_recipients)})


def edit_scholarship(ctx, scholarship_name=None, name=None, scholarship_type=None, coverage=None, value=None, description=None, max_recipients=None, is_active=None):
    obj = _pick('scholarship', ctx, scholarship_name or '')
    return _build(ctx, {'kind': 'edit_entry', 'item': 'scholarship', 'mode': 'edit', 'item_id': obj.id, 'fields': _fields(
        name=name, scholarship_type=scholarship_type, coverage=coverage, value=value, description=description, max_recipients=max_recipients, is_active=is_active)})


def revise_definition(ctx, payload, edits):
    return _build(ctx, payload)


def apply_definition(ctx, payload):
    from finance.views import DiscountViewSet, ScholarshipViewSet

    kind, mode = payload['item'], payload['mode']
    existing = None
    if mode == 'edit':
        from finance.models import Discount, Scholarship
        existing = (Discount if kind == 'discount' else Scholarship).objects.filter(school_id=ctx.school_id, pk=payload['item_id']).first()
    data = _clean(kind, ctx, payload['fields'], existing)
    data.pop('target_class_name', None)
    base = '/api/finance/discounts/' if kind == 'discount' else '/api/finance/scholarships/'
    view = DiscountViewSet if kind == 'discount' else ScholarshipViewSet
    if mode == 'create':
        data['academic_year'] = _year_id(ctx)
        code, body = call(ctx.user, ctx.school_id, view, {'post': 'create'}, 'post', base, data)
        ok = code in (200, 201)
    else:
        code, body = call(ctx.user, ctx.school_id, view, {'patch': 'partial_update'}, 'patch', f"{base}{payload['item_id']}/", data, pk=payload['item_id'])
        ok = code == 200
    if not ok:
        return {'ok': False, 'error': _fail(body, f'The {kind} could not be saved.')}
    return {'ok': True, 'id': (body or {}).get('id', payload.get('item_id'))}


# ── registration ─────────────────────────────────────────────────────────────

def _read(name, desc, props, handler, roles=FINANCE_ROLES, sub_agent='finance'):
    register(Tool(name=name, description=desc, parameters={'type': 'object', **_O, 'properties': props}, handler=handler,
                  sub_agent=sub_agent, module='finance', roles=roles))


def _write(name, desc, props, propose):
    register(Tool(name=name, description=desc, parameters={'type': 'object', **_O, 'properties': props}, handler=propose,
                  sub_agent='finance', module='finance', roles=ADMINS, kind='write', revise=revise_definition, apply=apply_definition))


_read('get_student_ledger', "One student's fee statement for the year, oldest first, with a running balance, payment dates and receipt numbers; "
      'totals add up (billed = received + pending). Set all_years for every year.', {**_WHO, 'all_years': {'type': 'boolean'}}, get_student_ledger,
      sub_agent='students')       # with get_student_fees: "Ali ka ledger" is a question about ONE student, so the router must offer it next to his fee tools
_read('get_receipts', 'Payments received in a date range (default: this month so far): receipt number, date, student, amount, method, account, collector, '
      'with the total and a split by method. Filter by student, class / section or method.',
      {'date_from': _DATE, 'date_to': _DATE, **_WHO, 'class_name': {'type': 'string'}, 'section': {'type': 'string'},
       'method': {'type': 'string', 'description': 'CASH, BANK_TRANSFER, ...'}}, get_receipts)
_read('get_account_ledger', "The running statement of ONE account (cash, bank...): opening and closing balance and the newest entries in a date range.",
      {'account_id': {'type': 'integer'}, 'account_name': {'type': 'string'}, 'date_from': _DATE, 'date_to': _DATE}, get_account_ledger)

_DISCOUNT = {'discount_type': {'type': 'string', 'enum': list(DISCOUNT_TYPES)}, 'value': {'type': 'number', 'description': 'Percent (0-100) or an amount'},
             'applies_to': {'type': 'string', 'enum': list(APPLIES_TO)}, 'class_name': {'type': 'string', 'description': 'When applies_to is CLASS, e.g. "Class 5"'},
             'grade_level': {'type': 'integer'}, 'start_date': _DATE, 'end_date': _DATE, 'max_uses': {'type': 'integer'}, 'stackable': {'type': 'boolean'}}
_SCHOLAR = {'scholarship_type': {'type': 'string', 'enum': list(SCHOLARSHIP_TYPES)}, 'coverage': {'type': 'string', 'enum': list(COVERAGES)},
            'value': {'type': 'number'}, 'description': {'type': 'string'}, 'max_recipients': {'type': 'integer'}}
_write('create_discount', 'PREPARE a new discount rule for this academic year (for example "10% for siblings" or "500 off Class 5"). '
       'Giving it to ONE student is assign_student_discount. Nothing is saved until the user approves.', {'name': {'type': 'string'}, **_DISCOUNT}, create_discount)
_write('edit_discount', 'PREPARE changing an existing discount rule (value, dates, class, active or not). Nothing is saved until the user approves.',
       {'discount_name': {'type': 'string'}, 'name': {'type': 'string', 'description': 'New name'}, **_DISCOUNT, 'is_active': {'type': 'boolean'}}, edit_discount)
_write('create_scholarship', 'PREPARE a new scholarship programme for this academic year. Nothing is saved until the user approves.',
       {'name': {'type': 'string'}, **_SCHOLAR}, create_scholarship)
_write('edit_scholarship', 'PREPARE changing an existing scholarship programme. Nothing is saved until the user approves.',
       {'scholarship_name': {'type': 'string'}, 'name': {'type': 'string', 'description': 'New name'}, **_SCHOLAR, 'is_active': {'type': 'boolean'}}, edit_scholarship)
