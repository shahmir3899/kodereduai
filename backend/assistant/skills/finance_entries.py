"""Expense and other-income entries: read, add, edit, delete (all writes via preview -> approve).

Reads, edits and deletes go through ExpenseViewSet / OtherIncomeViewSet, so whatever the
Finance screen hides (sensitive entries for a principal, hidden accounts) the assistant cannot
see either, and closed months (MonthlyClosing) refuse changes exactly as they do in the UI.
Only admins and principals can write there today (finance managers are read-only), so the write
tools are admin-only too.
"""
import difflib
from datetime import date
from decimal import Decimal

from django.utils import timezone

from ..internal_api import call
from ..registry import ADMINS, FINANCE_ROLES, ProposalError, Tool, register
from .finance_writes import MONEY, _choose_account, _money
from . import lms_common as lc

KINDS = {
    'expense': {'label': 'expense', 'sign': -1, 'path': '/api/finance/expenses/'},
    'income': {'label': 'income', 'sign': 1, 'path': '/api/finance/other-income/'},
}
MAX_ENTRIES = 30


def _viewset(kind):
    from finance.views import ExpenseViewSet, OtherIncomeViewSet
    return ExpenseViewSet if kind == 'expense' else OtherIncomeViewSet


def _category_model(kind):
    from finance.models import ExpenseCategory, IncomeCategory
    return ExpenseCategory if kind == 'expense' else IncomeCategory


def _categories(ctx, kind):
    """Active categories this role may use. Schools get default categories the first time the
    category screen is opened, so open it once if there are none yet."""
    from finance.views import ExpenseCategoryViewSet, IncomeCategoryViewSet

    def query():
        qs = _category_model(kind).objects.filter(school_id=ctx.school_id, is_active=True)
        if kind == 'expense' and ctx.role == 'PRINCIPAL':
            qs = qs.filter(is_sensitive=False)
        return list(qs)

    cats = query()
    if not cats:
        vs = ExpenseCategoryViewSet if kind == 'expense' else IncomeCategoryViewSet
        call(ctx.user, ctx.school_id, vs, {'get': 'list'}, 'get', f'/api/finance/{kind}-categories/')
        cats = query()
    return cats


def _resolve_category(ctx, kind, name):
    cats = _categories(ctx, kind)
    if not name:
        raise ProposalError('Which category? Ask the user. Categories: ' + ', '.join(c.name for c in cats))
    want = lc.tokens(name)
    hits = [c for c in cats if all(w in lc.tokens(c.name) for w in want) or lc.flat(name) in (lc.flat(c.name), lc.flat(c.code))]
    if not hits:
        hits = [c for c in cats if any(difflib.SequenceMatcher(None, w, t).ratio() >= 0.8 for w in want for t in lc.tokens(c.name))]
    if not hits:
        raise ProposalError(f'No {kind} category matching "{name}". Categories: ' + ', '.join(c.name for c in cats))
    if len(hits) > 1:
        raise ProposalError(f'"{name}" matches several categories: ' + ', '.join(c.name for c in hits) + '. Ask the user which one.')
    return hits[0]


def _check_open_period(ctx, d):
    from finance.models import MonthlyClosing

    if MonthlyClosing.objects.filter(school_id=ctx.school_id, year=d.year, month=d.month).exists():
        raise ProposalError(f'{d.year}/{d.month:02d} is closed for changes. Reopen the month in Finance first, or use another date.')


# ── reading ───────────────────────────────────────────────────────────────────

def _list(ctx, kind, date_from=None, date_to=None, category_name=None, min_amount=None, limit=25):
    params = {'page_size': min(int(limit), 50)}
    if date_from:
        params['date_from'] = lc.parse_date(date_from, 'date_from').isoformat()
    if date_to:
        params['date_to'] = lc.parse_date(date_to, 'date_to').isoformat()
    if category_name:
        cat = _resolve_category(ctx, kind, category_name)
        params['category'] = cat.id
    status, data = call(ctx.user, ctx.school_id, _viewset(kind), {'get': 'list'}, 'get', KINDS[kind]['path'], params)
    if status != 200:
        raise ProposalError('Could not read these entries (no permission or finance is unavailable).')
    rows = data['results'] if isinstance(data, dict) and 'results' in data else data
    if min_amount:
        rows = [r for r in rows if Decimal(str(r['amount'])) >= Decimal(str(min_amount))]
    return {'count': data.get('count', len(rows)) if isinstance(data, dict) else len(rows), 'shown': len(rows),
            'entries': [{'id': r['id'], 'date': r['date'], 'category': r.get('category_name'), 'amount': r['amount'],
                         'description': r.get('description', ''), 'account': r.get('account_name')} for r in rows]}


def list_expenses(ctx, **kw):
    return _list(ctx, 'expense', **kw)


def list_other_income(ctx, **kw):
    return _list(ctx, 'income', **kw)


# ── add ───────────────────────────────────────────────────────────────────────

def _build_entries(ctx, payload):
    kind = payload['entry_kind']
    cfg = KINDS[kind]
    account, _ = _choose_account(ctx, payload['account'])
    cats = {c.id: c for c in _categories(ctx, kind)}
    rows, preview_rows, total = [], [], Decimal('0')
    for r in payload['rows']:
        cat = cats.get(r['category'])
        if cat is None:
            raise ProposalError(f'The category for "{r["description"]}" is no longer available.')
        amount = _money(r['amount'])
        if amount <= 0:
            raise ProposalError('An amount must be above zero.')
        d = lc.parse_date(r['date'], 'date')
        _check_open_period(ctx, d)
        if not r['description'].strip():
            raise ProposalError('Every entry needs a description.')
        rows.append({**r, 'amount': str(amount)})
        total += amount
        preview_rows.append({'key': r['key'], 'date': r['date'], 'category': cat.name,
                             'description': r['description'], 'amount': float(amount)})
    if not rows:
        raise ProposalError('Nothing left to record.')
    warnings = []
    if any(date.fromisoformat(r['date']) > timezone.localdate() for r in rows):
        warnings.append('A date is in the future.')
    delta = total * cfg['sign']
    new_payload = {**payload, 'rows': rows, 'account': account['id']}
    return {'payload': new_payload, 'preview': {
        'kind': f'{kind}_entries', 'title': f'Record {cfg["label"]}',
        'summary': f'{len(rows)} {cfg["label"]} entr{"y" if len(rows) == 1 else "ies"}, total Rs {total:,.2f}, '
                   f'{"paid from" if kind == "expense" else "received into"} {account["name"]}',
        'columns': ['Date', 'Category', 'Description', 'Amount'], 'rows': preview_rows,
        'totals': {'count': len(rows), 'amount': float(total)},
        'account': {'id': account['id'], 'name': account['name'], 'balance_before': float(account['balance']),
                    'balance_after': float(account['balance'] + delta), 'note': 'Estimate from the current balance.'},
        'warnings': warnings,
        'editable': {'account_id': True, 'remove_keys': True, 'amounts': True, 'descriptions': True,
                     'categories': True, 'dates': True, 'is_sensitive': kind == 'expense'},
    }}


def _propose_entries(ctx, kind, entries, account_id, entry_date, is_sensitive):
    if not entries:
        raise ProposalError(f'What {kind}? Give at least one entry with an amount and description. Ask the user for what is missing.')
    if len(entries) > MAX_ENTRIES:
        raise ProposalError(f'Please record at most {MAX_ENTRIES} entries at a time.')
    default_date = lc.parse_date(entry_date, 'date').isoformat() if entry_date else timezone.localdate().isoformat()
    rows = []
    for i, e in enumerate(entries, start=1):
        cat = _resolve_category(ctx, kind, e.get('category_name'))
        rows.append({'key': str(i), 'category': cat.id, 'amount': str(_money(e.get('amount'))),
                     'description': (e.get('description') or '').strip(),
                     'date': lc.parse_date(e['date'], 'date').isoformat() if e.get('date') else default_date})
    account, _ = _choose_account(ctx, account_id)
    return _build_entries(ctx, {'kind': 'entries', 'entry_kind': kind, 'rows': rows, 'account': account['id'],
                                'is_sensitive': bool(is_sensitive)})


def record_expenses(ctx, entries=None, account_id=None, date=None, is_sensitive=False):
    return _propose_entries(ctx, 'expense', entries, account_id, date, is_sensitive)


def record_other_income(ctx, entries=None, account_id=None, date=None, is_sensitive=False):
    return _propose_entries(ctx, 'income', entries, account_id, date, is_sensitive)


def revise_entries(ctx, payload, edits):
    payload = {**payload, 'rows': [dict(r) for r in payload['rows']]}
    kind = payload['entry_kind']
    by_key = {r['key']: r for r in payload['rows']}
    mentioned = set(edits.get('remove_keys') or []) | set(edits.get('amounts') or {}) | set(edits.get('descriptions') or {}) \
        | set(edits.get('categories') or {}) | set(edits.get('dates') or {})
    if mentioned - set(by_key):
        raise ProposalError('Rows not on this card: ' + ', '.join(sorted(mentioned - set(by_key))))
    if edits.get('account_id'):
        payload['account'] = int(edits['account_id'])
    if 'is_sensitive' in edits:
        payload['is_sensitive'] = bool(edits['is_sensitive'])
    for k, v in (edits.get('amounts') or {}).items():
        by_key[k]['amount'] = str(_money(v))
    for k, v in (edits.get('descriptions') or {}).items():
        by_key[k]['description'] = str(v).strip()
    for k, v in (edits.get('dates') or {}).items():
        by_key[k]['date'] = lc.parse_date(v, 'date').isoformat()
    for k, v in (edits.get('categories') or {}).items():
        by_key[k]['category'] = _resolve_category(ctx, kind, v).id
    payload['rows'] = [r for r in payload['rows'] if r['key'] not in set(edits.get('remove_keys') or [])]
    return _build_entries(ctx, payload)


def apply_entries(ctx, payload):
    kind = payload['entry_kind']
    done, failed = [], []
    for r in payload['rows']:
        data = {'category': r['category'], 'amount': r['amount'], 'date': r['date'], 'description': r['description'],
                'account': payload['account']}
        if payload.get('is_sensitive'):
            data['is_sensitive'] = True
        status, body = call(ctx.user, ctx.school_id, _viewset(kind), {'post': 'create'}, 'post', KINDS[kind]['path'], data)
        if status == 201:
            done.append({'key': r['key'], 'id': body.get('id')})
        else:
            failed.append({'key': r['key'], 'error': _err(body)})
    total = sum((Decimal(r['amount']) for r in payload['rows'] if r['key'] in {d['key'] for d in done}), Decimal('0'))
    return {'ok': bool(done), 'created': len(done), 'failed': len(failed), 'total': float(total), 'rows': done, 'errors': failed,
            **({} if done else {'error': 'Nothing could be saved: ' + (failed[0]['error'] if failed else '')})}


def _err(body):
    if isinstance(body, dict):
        return str(body.get('detail') or body.get('error') or body)[:300]
    return str(body)[:300]


# ── edit / delete existing entries ───────────────────────────────────────────

def _fetch(ctx, kind, entry_id):
    status, data = call(ctx.user, ctx.school_id, _viewset(kind), {'get': 'retrieve'}, 'get', f'{KINDS[kind]["path"]}{entry_id}/', pk=entry_id)
    return data if status == 200 else None


def _entry_row(e):
    return {'id': e['id'], 'date': e['date'], 'category': e.get('category_name'), 'amount': float(e['amount']),
            'description': e.get('description', ''), 'account': e.get('account_name')}


def _delete_card(ctx, kind, ids):
    found = [e for e in (_fetch(ctx, kind, i) for i in ids) if e]
    if not found:
        raise ProposalError('Nothing to delete: those entries do not exist or you cannot see them.')
    total = sum(Decimal(str(e['amount'])) for e in found)
    warnings = []
    if len(found) < len(ids):
        warnings.append(f'{len(ids) - len(found)} entr{"y" if len(ids) - len(found) == 1 else "ies"} not found and left out.')
    return {'payload': {'kind': 'delete_entries', 'entry_kind': kind, 'ids': [e['id'] for e in found]}, 'preview': {
        'kind': 'delete_entries', 'title': f'Delete {KINDS[kind]["label"]} entries',
        'summary': f'Delete {len(found)} {KINDS[kind]["label"]} entr{"y" if len(found) == 1 else "ies"}, Rs {total:,.2f} - cannot be undone',
        'columns': ['Date', 'Category', 'Description', 'Amount'], 'rows': [_entry_row(e) for e in found],
        'totals': {'count': len(found), 'amount': float(total)}, 'warnings': warnings, 'editable': {'remove_ids': True},
    }}


def delete_finance_entries(ctx, entry_kind=None, ids=None):
    if entry_kind not in KINDS or not ids:
        raise ProposalError('Which entries? Give entry_kind (expense or income) and ids - find them with list_expenses / list_other_income. '
                            'Ask the user to confirm which entry when it is not clear.')
    return _delete_card(ctx, entry_kind, [int(i) for i in ids][:MAX_ENTRIES])


def revise_delete_entries(ctx, payload, edits):
    remove = {int(i) for i in edits.get('remove_ids') or []}
    if remove - set(payload['ids']):
        raise ProposalError('Some rows to remove are not on this card.')
    return _delete_card(ctx, payload['entry_kind'], [i for i in payload['ids'] if i not in remove])


def apply_delete_entries(ctx, payload):
    kind, done, failed = payload['entry_kind'], [], []
    for i in payload['ids']:
        status, body = call(ctx.user, ctx.school_id, _viewset(kind), {'delete': 'destroy'}, 'delete', f'{KINDS[kind]["path"]}{i}/', pk=i)
        (done if status == 204 else failed).append({'id': i} if status == 204 else {'id': i, 'error': _err(body)})
    return {'ok': bool(done), 'deleted': len(done), 'failed': len(failed), 'errors': failed,
            **({} if done else {'error': 'Nothing was deleted: ' + (failed[0]['error'] if failed else '')})}


def _edit_card(ctx, payload):
    kind, current = payload['entry_kind'], _fetch(ctx, payload['entry_kind'], payload['id'])
    if current is None:
        raise ProposalError('That entry does not exist or you cannot see it.')
    ch = dict(payload['changes'])
    if not ch:
        raise ProposalError('Nothing to change. Say what should be different (amount, description, category, date, account).')
    _check_open_period(ctx, lc.parse_date(current['date'], 'date'))
    if 'date' in ch:
        _check_open_period(ctx, lc.parse_date(ch['date'], 'date'))
    diffs, account = [], None
    cats = {c.id: c.name for c in _categories(ctx, kind)}
    if 'amount' in ch:
        ch['amount'] = str(_money(ch['amount']))
        if Decimal(ch['amount']) <= 0:
            raise ProposalError('An amount must be above zero.')
        diffs.append({'field': 'amount', 'from': float(current['amount']), 'to': float(ch['amount'])})
    if 'description' in ch:
        diffs.append({'field': 'description', 'from': current.get('description', ''), 'to': ch['description']})
    if 'date' in ch:
        diffs.append({'field': 'date', 'from': current['date'], 'to': ch['date']})
    if 'category' in ch:
        diffs.append({'field': 'category', 'from': current.get('category_name'), 'to': cats.get(ch['category'], '?')})
    if 'account' in ch:
        account, _ = _choose_account(ctx, ch['account'])
        diffs.append({'field': 'account', 'from': current.get('account_name'), 'to': account['name']})
    delta = None
    if 'amount' in ch:
        delta = (Decimal(ch['amount']) - Decimal(str(current['amount']))) * KINDS[kind]['sign']
    return {'payload': {**payload, 'changes': ch}, 'preview': {
        'kind': 'edit_entry', 'title': f'Edit {KINDS[kind]["label"]} entry',
        'summary': f'Change {KINDS[kind]["label"]} #{payload["id"]} ({current.get("description", "")[:40]}): ' + ', '.join(d['field'] for d in diffs),
        'columns': ['Field', 'Now', 'Change to'], 'rows': diffs, 'totals': {'count': 1},
        'effect_on_balance': float(delta) if delta is not None else None,
        'warnings': [], 'editable': {'amount': True, 'description': True, 'date': True, 'category': True, 'account_id': True},
    }}


def edit_finance_entry(ctx, entry_kind=None, entry_id=None, amount=None, description=None, date=None, category_name=None, account_id=None):
    if entry_kind not in KINDS or not entry_id:
        raise ProposalError('Which entry? Give entry_kind (expense or income) and entry_id - find it with list_expenses / list_other_income.')
    ch = {}
    if amount is not None:
        ch['amount'] = str(_money(amount))
    if description:
        ch['description'] = description.strip()
    if date:
        ch['date'] = lc.parse_date(date, 'date').isoformat()
    if category_name:
        ch['category'] = _resolve_category(ctx, entry_kind, category_name).id
    if account_id:
        ch['account'] = int(account_id)
    return _edit_card(ctx, {'kind': 'edit_entry', 'entry_kind': entry_kind, 'id': int(entry_id), 'changes': ch})


def revise_edit_entry(ctx, payload, edits):
    ch = dict(payload['changes'])
    for field, key in (('amount', 'amount'), ('description', 'description'), ('date', 'date')):
        if key in edits:
            ch[field] = str(edits[key]).strip()
    if edits.get('category'):
        ch['category'] = _resolve_category(ctx, payload['entry_kind'], edits['category']).id
    if edits.get('account_id'):
        ch['account'] = int(edits['account_id'])
    if 'date' in ch:
        ch['date'] = lc.parse_date(ch['date'], 'date').isoformat()
    return _edit_card(ctx, {**payload, 'changes': ch})


def apply_edit_entry(ctx, payload):
    kind = payload['entry_kind']
    status, body = call(ctx.user, ctx.school_id, _viewset(kind), {'patch': 'partial_update'}, 'patch',
                        f'{KINDS[kind]["path"]}{payload["id"]}/', payload['changes'], pk=payload['id'])
    if status != 200:
        return {'ok': False, 'error': _err(body)}
    return {'ok': True, 'updated': payload['id']}


# ── registration ─────────────────────────────────────────────────────────────

_O = {'additionalProperties': False}
_KIND = {'type': 'string', 'enum': ['expense', 'income']}
_ENTRY = {'type': 'object', 'additionalProperties': False, 'required': ['amount', 'description'], 'properties': {
    'amount': {'type': 'number'}, 'description': {'type': 'string'},
    'category_name': {'type': 'string', 'description': 'e.g. Utilities, Salary, Stationery, Donation'},
    'date': {'type': 'string', 'description': 'YYYY-MM-DD, defaults to the top-level date or today'}}}
_COMMON = {
    'account_id': {'type': 'integer'},
    'date': {'type': 'string', 'description': 'YYYY-MM-DD for all entries, default today'},
    'is_sensitive': {'type': 'boolean', 'description': 'Hide from staff; only if the user asked'},
}
_LIST = {'date_from': {'type': 'string'}, 'date_to': {'type': 'string'}, 'category_name': {'type': 'string'},
         'min_amount': {'type': 'number'}, 'limit': {'type': 'integer', 'minimum': 1, 'maximum': 50}}

register(Tool(
    name='list_expenses', description='List expense entries (with ids) for a date range / category. Use to find an entry before editing or deleting it.',
    parameters={'type': 'object', **_O, 'properties': _LIST}, handler=list_expenses, sub_agent='finance', module='finance', roles=FINANCE_ROLES,
))
register(Tool(
    name='list_other_income', description='List non-fee income entries (with ids) for a date range / category.',
    parameters={'type': 'object', **_O, 'properties': _LIST}, handler=list_other_income, sub_agent='finance', module='finance', roles=FINANCE_ROLES,
))
register(Tool(
    name='record_expenses',
    description=('PREPARE one or more expenses for review ("5000 bijli ka bill diya", "add expense of 5000 for electricity"). Each entry '
                 'needs an amount, a description and a category. Nothing is saved until the user presses Approve. If the account or '
                 'category is unclear, ask the user first.'),
    parameters={'type': 'object', **_O, 'properties': {'entries': {'type': 'array', 'items': _ENTRY}, **_COMMON}},
    handler=record_expenses, sub_agent='finance', module='finance', roles=ADMINS, kind='write',
    revise=revise_entries, apply=apply_entries,
))
register(Tool(
    name='record_other_income',
    description=('PREPARE one or more non-fee income entries (donation, book sale, event) for review. Nothing is saved until the user '
                 'presses Approve. For student fees use record_fee_payments instead.'),
    parameters={'type': 'object', **_O, 'properties': {'entries': {'type': 'array', 'items': _ENTRY}, **_COMMON}},
    handler=record_other_income, sub_agent='finance', module='finance', roles=ADMINS, kind='write',
    revise=revise_entries, apply=apply_entries,
))
register(Tool(
    name='edit_finance_entry',
    description='PREPARE a change to one existing expense or income entry (amount, description, date, category, account). Shows before/after; nothing changes until Approve.',
    parameters={'type': 'object', **_O, 'properties': {
        'entry_kind': _KIND, 'entry_id': {'type': 'integer'}, 'amount': {'type': 'number'}, 'description': {'type': 'string'},
        'date': {'type': 'string'}, 'category_name': {'type': 'string'}, 'account_id': {'type': 'integer'}}},
    handler=edit_finance_entry, sub_agent='finance', module='finance', roles=ADMINS, kind='write',
    revise=revise_edit_entry, apply=apply_edit_entry,
))
register(Tool(
    name='delete_finance_entries',
    description='PREPARE deleting expense or income entries by id (find ids with list_expenses / list_other_income). The card lists them; nothing is deleted until Approve.',
    parameters={'type': 'object', **_O, 'properties': {'entry_kind': _KIND, 'ids': {'type': 'array', 'items': {'type': 'integer'}}}},
    handler=delete_finance_entries, sub_agent='finance', module='finance', roles=ADMINS, kind='write',
    revise=revise_delete_entries, apply=apply_delete_entries,
))
