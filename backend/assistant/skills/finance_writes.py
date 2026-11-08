"""Finance write tools (proposal -> preview -> approve), first one: record fee payments.

Everything the preview shows is rebuilt from the database each time it is edited or
approved. The final write is `FeePaymentViewSet.bulk_update` - the same endpoint the Fees
screen uses - so its permission rules (admins only), period locks and Kuickpay protection
apply unchanged.
"""
import calendar
import difflib
import re
from datetime import date
from decimal import Decimal, InvalidOperation

from django.utils import timezone

from ..internal_api import call
from ..registry import ADMINS, ProposalError, Tool, register

METHODS = ['CASH', 'BANK_TRANSFER', 'ONLINE', 'OTHER']
MAX_ROWS = 200
MONEY = Decimal('0.01')


# ── helpers ───────────────────────────────────────────────────────────────────

def _money(value) -> Decimal:
    try:
        return Decimal(str(value)).quantize(MONEY)
    except (InvalidOperation, ValueError):
        raise ProposalError(f'"{value}" is not a valid amount.')


def _norm(text):
    return re.sub(r'[^a-z0-9 ]+', ' ', (text or '').lower()).split()


def _period_label(p):
    return f'{calendar.month_abbr[p.month]} {p.year}' if 1 <= p.month <= 12 else f'{p.fee_type.title()} {p.year}'


def _pending_queryset(school_id, class_name, month, year):
    from finance.ai_agent import _payment_class_q
    from finance.models import FeePayment

    today = timezone.localdate()
    qs = FeePayment.objects.filter(
        school_id=school_id, status__in=['UNPAID', 'PARTIAL'], month=month or today.month, year=year or today.year,
    ).select_related('student').order_by('student__name', 'id')
    if class_name:
        qs = qs.filter(_payment_class_q(class_name))
    return qs


def _row_info(school_id, payments):
    """{payment_id: (class label, roll)} using the payment's own year placement."""
    from academic_sessions.roster import placement_group, placement_roll, placements_for

    placements = placements_for(school_id, ((p.student_id, p.academic_year_id) for p in payments))
    out = {}
    for p in payments:
        placement = placements.get((p.student_id, p.academic_year_id))
        _key, label, _master = placement_group(placement, p.student)
        out[p.id] = (label, placement_roll(placement, p.student))
    return out


def _remaining(p) -> Decimal:
    return (p.amount_due - p.amount_paid).quantize(MONEY)


def _match_students(payments, names, ids, what):
    """Student ids selected by names/ids from this list. Ambiguous or unknown names raise,
    so the model asks the user instead of guessing which Ahmad was meant."""
    by_student = {}
    for p in payments:
        by_student.setdefault(p.student_id, p.student)
    chosen = set()
    for sid in ids or []:
        if int(sid) not in by_student:
            raise ProposalError(f'Student id {sid} is not in this list of unpaid fees.')
        chosen.add(int(sid))
    for name in names or []:
        want = _norm(name)
        if not want:
            continue
        hits = [sid for sid, st in by_student.items() if all(w in _norm(st.name) for w in want)]
        if not hits:   # tolerate spelling variants: Ahmad / Ahmed
            hits = [sid for sid, st in by_student.items()
                    if any(difflib.SequenceMatcher(None, w, t).ratio() >= 0.78
                           for w in want for t in _norm(st.name))]
        if not hits:
            raise ProposalError(
                f'No student matching "{name}" in this list. Students here: '
                + ', '.join(sorted(st.name for st in by_student.values())[:40]))
        if len(hits) > 1:
            options = '; '.join(f'{by_student[s].name} (student_id {s})' for s in hits[:8])
            raise ProposalError(
                f'"{name}" matches {len(hits)} students ({what}): {options}. Ask the user which one, '
                f'then pass student ids.')
        chosen.add(hits[0])
    return chosen


def _accounts(ctx):
    from finance.views import AccountViewSet

    status, data = call(ctx.user, ctx.school_id, AccountViewSet, {'get': 'balances'}, 'get',
                        '/api/finance/accounts/balances/')
    if status != 200:
        raise ProposalError('Could not read the accounts (no permission or finance is unavailable).')
    return [{'id': a['id'], 'name': a['name'], 'balance': Decimal(str(a['net_balance']))} for a in data['accounts']]


def _choose_account(ctx, account_id):
    accounts = _accounts(ctx)
    if not accounts:
        raise ProposalError('This school has no active account to receive payments.')
    if account_id:
        for a in accounts:
            if a['id'] == int(account_id):
                return a, accounts
        raise ProposalError('That account does not exist. Accounts: ' + ', '.join(f"{a['name']} (id {a['id']})" for a in accounts))
    if len(accounts) == 1:
        return accounts[0], accounts
    raise ProposalError('Which account should receive the money? Ask the user. Accounts: '
                        + ', '.join(f"{a['name']} (id {a['id']})" for a in accounts))


# ── building the card ─────────────────────────────────────────────────────────

def _build(ctx, payload):
    """Re-read every row and return {'payload','preview'}. Rows already settled drop out;
    amounts above what is still owed are clamped. Same code for propose, edit and approve."""
    from finance.models import FeePayment

    ids = [r['id'] for r in payload['rows']]
    payments = {p.id: p for p in FeePayment.objects.filter(school_id=ctx.school_id, id__in=ids).select_related('student')}
    info = _row_info(ctx.school_id, list(payments.values()))
    account, _accounts_list = _choose_account(ctx, payload['account'])

    rows, preview_rows, warnings = [], [], []
    total = Decimal('0')
    for r in payload['rows']:
        p = payments.get(r['id'])
        if p is None:
            warnings.append(f'Fee record {r["id"]} no longer exists and was removed.')
            continue
        left = _remaining(p)
        if left <= 0:
            warnings.append(f'{p.student.name} ({_period_label(p)}) is already fully paid and was removed.')
            continue
        pay = min(_money(r['pay']), left)
        rows.append({'id': p.id, 'pay': str(pay)})
        total += pay
        label, roll = info.get(p.id, ('', ''))
        preview_rows.append({
            'id': p.id, 'student': p.student.name, 'class': label, 'roll': roll,
            'period': _period_label(p), 'due': float(p.amount_due), 'already_paid': float(p.amount_paid),
            'remaining': float(left), 'paying': float(pay), 'partial': pay < left,
        })
    if not rows:
        raise ProposalError('Nothing left to record: every selected fee is already paid.')
    if len(rows) > MAX_ROWS:
        raise ProposalError(f'That is {len(rows)} records; please do it in batches of {MAX_ROWS} or fewer.')

    pay_date = date.fromisoformat(payload['payment_date'])
    if pay_date > timezone.localdate():
        warnings.append('The payment date is in the future.')
    if any(r['partial'] for r in preview_rows):
        warnings.append('Some rows pay less than the full remaining amount.')

    new_payload = {'rows': rows, 'account': account['id'], 'payment_method': payload['payment_method'],
                   'payment_date': payload['payment_date']}
    preview = {
        'kind': 'fee_payments',
        'title': 'Record fee payments',
        'summary': f'{len(rows)} students paid, total Rs {total:,.2f}, into {account["name"]}',
        'columns': ['Student', 'Class', 'Period', 'Due', 'Paying'],
        'rows': preview_rows,
        'totals': {'count': len(rows), 'paying': float(total)},
        'account': {'id': account['id'], 'name': account['name'],
                    'balance_before': float(account['balance']), 'balance_after': float(account['balance'] + total),
                    'note': 'Estimate from the current balance.'},
        'payment_method': payload['payment_method'],
        'payment_date': payload['payment_date'],
        'warnings': warnings,
        'editable': {'account_id': True, 'payment_method': METHODS, 'payment_date': True,
                     'remove_ids': True, 'amounts': True},
    }
    return {'payload': new_payload, 'preview': preview}


# ── the tools ─────────────────────────────────────────────────────────────────

_SCOPE = {
    'class_name': {'type': 'string', 'description': 'Class name, e.g. "Class 5" or "8B"'},
    'month': {'type': 'integer', 'minimum': 1, 'maximum': 12, 'description': 'Defaults to the current month'},
    'year': {'type': 'integer'},
}


def find_pending_fee_payments(ctx, class_name=None, month=None, year=None):
    qs = _pending_queryset(ctx.school_id, class_name, month, year)
    payments = list(qs[:MAX_ROWS])
    info = _row_info(ctx.school_id, payments)
    rows, total = [], Decimal('0')
    for p in payments:
        left = _remaining(p)
        total += left
        label, roll = info.get(p.id, ('', ''))
        rows.append({'payment_id': p.id, 'student_id': p.student_id, 'student': p.student.name, 'class': label,
                     'roll_number': roll, 'period': _period_label(p), 'due': float(p.amount_due),
                     'paid': float(p.amount_paid), 'remaining': float(left)})
    return {'count': len(rows), 'total_remaining': float(total), 'class_filter': class_name,
            'students': rows[:60], 'truncated': len(rows) > 60}


def propose_fee_payments(ctx, class_name=None, month=None, year=None, only_names=None, only_student_ids=None,
                         exclude_names=None, exclude_student_ids=None, account_id=None,
                         payment_method='CASH', payment_date=None):
    if not (class_name or only_names or only_student_ids):
        raise ProposalError('Say which class (or which students) the payments are for.')
    payments = list(_pending_queryset(ctx.school_id, class_name, month, year)[:MAX_ROWS + 1])
    if not payments:
        raise ProposalError('No unpaid fees found for that class and month.')

    selected = {p.student_id for p in payments}
    if only_names or only_student_ids:
        selected = _match_students(payments, only_names, only_student_ids, 'to include')
    if exclude_names or exclude_student_ids:
        selected -= _match_students(payments, exclude_names, exclude_student_ids, 'to leave out')
    chosen = [p for p in payments if p.student_id in selected]
    if not chosen:
        raise ProposalError('After leaving those students out, nobody is left to record.')

    account, _ = _choose_account(ctx, account_id)
    when = date.fromisoformat(payment_date) if payment_date else timezone.localdate()
    payload = {'rows': [{'id': p.id, 'pay': str(_remaining(p))} for p in chosen], 'account': account['id'],
               'payment_method': payment_method, 'payment_date': when.isoformat()}
    return _build(ctx, payload)


def revise_fee_payments(ctx, payload, edits):
    payload = {**payload, 'rows': [dict(r) for r in payload['rows']]}
    if edits.get('account_id'):
        payload['account'] = int(edits['account_id'])
    if edits.get('payment_method'):
        if edits['payment_method'] not in METHODS:
            raise ProposalError(f'Payment method must be one of {", ".join(METHODS)}.')
        payload['payment_method'] = edits['payment_method']
    if edits.get('payment_date'):
        try:
            payload['payment_date'] = date.fromisoformat(str(edits['payment_date'])).isoformat()
        except ValueError:
            raise ProposalError('Payment date must look like 2026-11-07.')
    known = {r['id'] for r in payload['rows']}
    remove = {int(i) for i in edits.get('remove_ids') or []}
    if remove - known:
        raise ProposalError('Some rows to remove are not part of this card.')
    payload['rows'] = [r for r in payload['rows'] if r['id'] not in remove]
    for key, amount in (edits.get('amounts') or {}).items():
        row = next((r for r in payload['rows'] if r['id'] == int(key)), None)
        if row is None:
            raise ProposalError(f'Row {key} is not part of this card.')
        amount = _money(amount)
        if amount <= 0:
            raise ProposalError('An amount must be above zero; remove the row instead.')
        row['pay'] = str(amount)
    return _build(ctx, payload)


def apply_fee_payments(ctx, payload):
    from finance.models import FeePayment
    from finance.views import FeePaymentViewSet

    payments = {p.id: p for p in FeePayment.objects.filter(
        school_id=ctx.school_id, id__in=[r['id'] for r in payload['rows']]).select_related('student')}
    records, targets = [], {}
    for r in payload['rows']:
        p = payments[r['id']]
        target = (p.amount_paid + Decimal(r['pay'])).quantize(MONEY)
        targets[p.id] = target
        records.append({'id': p.id, 'amount_paid': str(target), 'payment_date': payload['payment_date'],
                        'payment_method': payload['payment_method'], 'account': payload['account']})

    status, data = call(ctx.user, ctx.school_id, FeePaymentViewSet, {'post': 'bulk_update'}, 'post',
                        '/api/finance/fee-payments/bulk_update/', {'records': records})
    if status != 200:
        detail = (data or {}).get('detail') if isinstance(data, dict) else None
        return {'ok': False, 'error': detail or f'The fee API refused the request (HTTP {status}).'}

    after = {p.id: p for p in FeePayment.objects.filter(id__in=list(targets))}
    rows, total = [], Decimal('0')
    for pid, target in targets.items():
        ok = after[pid].amount_paid >= target
        if ok:
            total += Decimal([r for r in payload['rows'] if r['id'] == pid][0]['pay'])
        rows.append({'id': pid, 'student': payments[pid].student.name, 'ok': ok})
    done = sum(1 for r in rows if r['ok'])
    return {'ok': done > 0, 'updated': done, 'failed': len(rows) - done, 'errors': data.get('errors', []),
            'total_paid': float(total), 'rows': rows,
            **({} if done else {'error': 'None of the payments could be saved: ' + '; '.join(data.get('errors', [])[:3])})}


register(Tool(
    name='find_pending_fee_payments',
    description='List students with UNPAID or PARTIAL fees for a class and month, with names, amounts and ids. '
                'Use this when the user asks who has not paid ("naam batao"). Defaults to the current month.',
    parameters={'type': 'object', 'properties': _SCOPE, 'additionalProperties': False},
    handler=find_pending_fee_payments, sub_agent='finance', module='finance', roles=ADMINS + ('ACCOUNTANT',),
))

register(Tool(
    name='record_fee_payments',
    description=(
        'PREPARE (not execute) fee payments for review. Use when the user says fees were received, e.g. '
        '"ahmad aur akram ke ilawa sab ki fee aa gai" -> class_name + exclude_names. Records the full remaining '
        'amount for every selected student; the user can edit amounts on the card. Nothing is saved until the '
        'user presses Approve. If a name matches several students, ask the user which one. If account_id is '
        'missing and there are several accounts, ask the user which account.'),
    parameters={'type': 'object', 'properties': {
        **_SCOPE,
        'only_names': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Record only these students'},
        'only_student_ids': {'type': 'array', 'items': {'type': 'integer'}},
        'exclude_names': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Everyone except these'},
        'exclude_student_ids': {'type': 'array', 'items': {'type': 'integer'}},
        'account_id': {'type': 'integer'},
        'payment_method': {'type': 'string', 'enum': METHODS},
        'payment_date': {'type': 'string', 'description': 'YYYY-MM-DD, defaults to today'},
    }, 'additionalProperties': False},
    handler=propose_fee_payments, sub_agent='finance', module='finance', roles=ADMINS, kind='write',
    revise=revise_fee_payments, apply=apply_fee_payments,
))
