"""Inventory through Aura (Operations agent): stock levels, reorder suggestions, transactions, who holds what; stock in and stock out.

Admins and principal only (owner decision 2026-11-08). Reads and writes go through InventoryItemViewSet / StockTransactionViewSet /
ItemAssignmentViewSet / ReorderPredictionView as the signed-in user, so the app's rules apply: the quantity sign per transaction type and
the "not enough stock" check. Writes only PROPOSE.
Left out: creating items / categories / vendors, assigning an item to a person, adjustments.
"""
from decimal import Decimal, InvalidOperation

from django.utils import timezone

from ..internal_api import call
from ..registry import ADMINS, ProposalError, Tool, register
from . import lms_common as lc
from .student_tools import _fail, _items

LIST_LIMIT = 40
IN_TYPES = ('PURCHASE', 'RETURN')
OUT_TYPES = ('ISSUE', 'DISPOSAL')


def _item_row(i):
    return {'item_id': i['id'], 'name': i['name'], 'category': i.get('category_name'), 'unit': i.get('unit_display') or i.get('unit'),
            'stock': i['current_stock'], 'minimum': i['minimum_stock'], 'location': i.get('location') or None}


def _find_item(ctx, name, item_id=None):
    from inventory.models import InventoryItem

    qs = InventoryItem.objects.filter(school_id=ctx.school_id, is_active=True)
    if item_id:
        it = qs.filter(id=int(item_id)).first()
        if it is None:
            raise ProposalError(f'No item with id {item_id}.')
        return it
    want = lc.tokens(name)
    if not want:
        raise ProposalError('Which item? Ask the user.')
    pool = [i for i in qs if all(w in lc.tokens(i.name) for w in want)]
    exact = [i for i in pool if i.name.lower() == name.strip().lower()]
    if len(exact) == 1:
        return exact[0]
    if not pool:
        raise ProposalError(f'No inventory item matching "{name}".')
    if len(pool) > 1:
        raise ProposalError('Several items match: ' + '; '.join(f'{i.name} ({i.current_stock} in stock, item_id {i.id})' for i in pool[:8])
                            + '. Ask which one, then pass item_id.')
    return pool[0]


# ── reads ────────────────────────────────────────────────────────────────────

def get_inventory_stock(ctx, search=None, stock_status=None):
    from inventory.views import InventoryItemViewSet

    params = {'page_size': 200, 'is_active': 'true', **({'search': search} if search else {}), **({'stock_status': stock_status} if stock_status else {})}
    st, body = call(ctx.user, ctx.school_id, InventoryItemViewSet, {'get': 'list'}, 'get', '/api/inventory/items/', params)
    if st != 200:
        raise ProposalError(_fail(body, 'Could not read the inventory.'))
    rows = _items(body)
    return {'count': len(rows), 'items': [_item_row(i) for i in rows[:LIST_LIMIT]],
            **({'note': f'Showing the first {LIST_LIMIT}.'} if len(rows) > LIST_LIMIT else {})}


def get_low_stock_items(ctx):
    from inventory.views import InventoryItemViewSet

    st, body = call(ctx.user, ctx.school_id, InventoryItemViewSet, {'get': 'low_stock'}, 'get', '/api/inventory/items/low_stock/')
    if st != 200:
        raise ProposalError(_fail(body, 'Could not read the low-stock items.'))
    rows = _items(body)
    return {'count': len(rows), 'items': [_item_row(i) for i in rows[:LIST_LIMIT]]}


def get_reorder_suggestions(ctx, lookahead_days=None):
    from inventory.views import ReorderPredictionView

    st, body = call(ctx.user, ctx.school_id, ReorderPredictionView, {'get': 'get'}, 'get', '/api/inventory/reorder-prediction/',
                    {'lookahead_days': lookahead_days} if lookahead_days else {})
    if st != 200:
        raise ProposalError(_fail(body, 'Could not run the reorder prediction.'))
    return body


def list_stock_transactions(ctx, item_name=None, item_id=None, transaction_type=None, date_from=None, date_to=None):
    from inventory.views import StockTransactionViewSet

    params = {'page_size': 50, **{k: v for k, v in {'transaction_type': transaction_type, 'date_from': date_from, 'date_to': date_to}.items() if v}}
    if item_name or item_id:
        params['item_id'] = _find_item(ctx, item_name, item_id).id
    st, body = call(ctx.user, ctx.school_id, StockTransactionViewSet, {'get': 'list'}, 'get', '/api/inventory/transactions/', params)
    if st != 200:
        raise ProposalError(_fail(body, 'Could not read the transactions.'))
    rows = _items(body)
    return {'count': body.get('count', len(rows)) if isinstance(body, dict) else len(rows), 'transactions': [
        {'date': t['date'], 'item': t['item_name'], 'type': t['transaction_type_display'], 'quantity': t['quantity'], 'amount': float(t['total_amount']),
         'vendor': t.get('vendor_name'), 'remarks': (t.get('remarks') or '')[:80] or None} for t in rows[:LIST_LIMIT]]}


def get_item_holders(ctx, item_name=None, item_id=None):
    from inventory.views import ItemAssignmentViewSet

    params = {'page_size': 100, 'is_active': 'true'}
    if item_name or item_id:
        params['item_id'] = _find_item(ctx, item_name, item_id).id
    st, body = call(ctx.user, ctx.school_id, ItemAssignmentViewSet, {'get': 'list'}, 'get', '/api/inventory/assignments/', params)
    if st != 200:
        raise ProposalError(_fail(body, 'Could not read the assignments.'))
    rows = _items(body)
    return {'count': len(rows), 'assignments': [{k: a.get(k) for k in ('item_name', 'assigned_to_name', 'quantity', 'assigned_date', 'status') if k in a} for a in rows[:LIST_LIMIT]]}


# ── stock in / out ───────────────────────────────────────────────────────────

def _qty(value):
    try:
        d = Decimal(str(value))
    except (InvalidOperation, TypeError):
        raise ProposalError(f'"{value}" is not a quantity.')
    if d != d.to_integral_value() or d <= 0:
        raise ProposalError('Quantity must be a whole number above zero.')
    return int(d)


def _vendor(ctx, name):
    from inventory.models import Vendor

    if not name:
        return None
    want = lc.tokens(name)
    pool = list(Vendor.objects.filter(school_id=ctx.school_id))
    hits = [v for v in pool if all(w in lc.tokens(v.name) for w in want)]
    if len(hits) != 1:
        raise ProposalError(f'Vendor "{name}" is not clear. Vendors: ' + (', '.join(v.name for v in pool[:15]) or 'none') + '. Ask the user.')
    return hits[0]


def _build_stock(ctx, payload):
    from inventory.models import InventoryItem, Vendor

    direction = payload['direction']
    day = lc.parse_date(payload['date'], 'date')
    if day > timezone.localdate():
        raise ProposalError('The date cannot be in the future.')
    rows, lines, warnings = [], [], []
    for n, ln in enumerate(payload['lines']):
        it = InventoryItem.objects.filter(school_id=ctx.school_id, id=ln['item_id'], is_active=True).first()
        if it is None:
            warnings.append(f"Item {ln['item_id']} no longer exists and was removed.")
            continue
        qty = int(ln['quantity'])
        after = it.current_stock + qty if direction == 'in' else it.current_stock - qty
        if after < 0:
            raise ProposalError(f'Not enough stock of {it.name}: {it.current_stock} in stock, {qty} requested.')
        price = Decimal(str(ln['unit_price'])) if ln.get('unit_price') not in (None, '') else it.unit_price
        lines.append({**ln, 'quantity': qty})
        rows.append({'key': f'l{n}', 'item': it.name, 'type': ln['type'].title(), 'quantity': qty, 'before': it.current_stock, 'after': after,
                     'amount': float(price * qty) if direction == 'in' else None})
        if direction == 'out' and after <= it.minimum_stock:
            warnings.append(f'{it.name} will be at or below its minimum ({it.minimum_stock}).')
    if not rows:
        raise ProposalError('Nothing to record.')
    vendor = Vendor.objects.filter(school_id=ctx.school_id, id=payload.get('vendor_id')).first() if payload.get('vendor_id') else None
    total = round(sum(r['amount'] or 0 for r in rows), 2)
    word = 'Stock in' if direction == 'in' else 'Stock out'
    return {'payload': {**payload, 'lines': lines}, 'preview': {
        'kind': 'stock_entries', 'title': word, 'summary': f'{word}: {len(rows)} line(s) on {day}' + (f', Rs {total:,.0f}' if direction == 'in' and total else ''),
        'columns': ['Item', 'Type', 'Quantity', 'Stock now', 'Stock after'], 'rows': rows,
        'totals': {'count': len(rows), **({'amount': total} if direction == 'in' else {})}, 'warnings': warnings,
        'assumptions': {k: v for k, v in {'date': day.isoformat(), 'vendor': vendor.name if vendor else None, 'reference': payload.get('reference') or None}.items() if v},
        'editable': {'amounts': True, 'remove': True}}}


def _stock(direction, ctx, lines, date, vendor_name, reference, remarks, default_type):
    if not lines:
        raise ProposalError('Which items and how many? Ask the user.')
    allowed = IN_TYPES if direction == 'in' else OUT_TYPES
    out = []
    for ln in lines:
        it = _find_item(ctx, ln.get('item_name'), ln.get('item_id'))
        t = (ln.get('type') or default_type).upper()
        if t not in allowed:
            raise ProposalError(f'Type must be one of {", ".join(allowed)} here.')
        out.append({'item_id': it.id, 'quantity': _qty(ln.get('quantity')), 'type': t, 'unit_price': ln.get('unit_price')})
    vendor = _vendor(ctx, vendor_name) if direction == 'in' else None
    return _build_stock(ctx, {'kind': 'stock_entries', 'direction': direction, 'lines': out, 'vendor_id': vendor.id if vendor else None,
                              'date': (lc.parse_date(date, 'date') if date else timezone.localdate()).isoformat(),
                              'reference': (reference or '')[:50], 'remarks': (remarks or '')[:300]})


def record_stock_in(ctx, lines=None, date=None, vendor_name=None, reference=None, remarks=None):
    return _stock('in', ctx, lines, date, vendor_name, reference, remarks, 'PURCHASE')


def record_stock_out(ctx, lines=None, date=None, reference=None, remarks=None):
    return _stock('out', ctx, lines, date, None, reference, remarks, 'ISSUE')


def revise_stock(ctx, payload, edits):
    payload = {**payload, 'lines': [dict(l) for l in payload['lines']]}
    drop = {k for k in edits.get('remove_keys') or []}
    amounts = edits.get('amounts') or {}
    lines = []
    for n, ln in enumerate(payload['lines']):
        key = f'l{n}'
        if key in drop:
            continue
        if key in amounts:
            ln['quantity'] = _qty(amounts[key])
        lines.append(ln)
    payload['lines'] = lines
    return _build_stock(ctx, payload)


def apply_stock(ctx, payload):
    from inventory.views import StockTransactionViewSet

    done, errors = 0, []
    for ln in payload['lines']:
        qty = ln['quantity'] if payload['direction'] == 'in' else -ln['quantity']
        data = {'item': ln['item_id'], 'transaction_type': ln['type'], 'quantity': qty, 'date': payload['date'],
                'reference_number': payload.get('reference', ''), 'remarks': payload.get('remarks', ''),
                **({'unit_price': str(ln['unit_price'])} if ln.get('unit_price') not in (None, '') else {}),
                **({'vendor': payload['vendor_id']} if payload.get('vendor_id') else {})}
        st, body = call(ctx.user, ctx.school_id, StockTransactionViewSet, {'post': 'create'}, 'post', '/api/inventory/transactions/', data)
        if st in (200, 201):
            done += 1
        else:
            errors.append(f"item {ln['item_id']}: {_fail(body, 'failed')}")
    return {'ok': done > 0, 'recorded': done, 'errors': errors, **({} if done else {'error': '; '.join(errors)[:300]})}


# ── registration ─────────────────────────────────────────────────────────────

_O = {'additionalProperties': False}
_ITEM = {'item_name': {'type': 'string'}, 'item_id': {'type': 'integer'}}
_DATE = {'type': 'string', 'description': 'YYYY-MM-DD, defaults to today'}


def _read(name, desc, props, handler):
    register(Tool(name=name, description=desc, parameters={'type': 'object', **_O, 'properties': props}, handler=handler,
                  sub_agent='operations', module='inventory', roles=ADMINS))


def _lines_schema(types):
    return {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'properties': {
        **_ITEM, 'quantity': {'type': 'integer'}, 'type': {'type': 'string', 'enum': list(types)},
        'unit_price': {'type': 'number', 'description': 'Optional; defaults to the item price'}}}}


_read('get_inventory_stock', 'Current stock of inventory items; search by name and/or filter stock_status out, low or ok. Use for "how many chairs are left?".',
      {'search': {'type': 'string'}, 'stock_status': {'type': 'string', 'enum': ['out', 'low', 'ok']}}, get_inventory_stock)
_read('get_low_stock_items', 'Active items at or below their minimum stock.', {}, get_low_stock_items)
_read('get_reorder_suggestions', 'Items likely to run out soon, from past usage.', {'lookahead_days': {'type': 'integer'}}, get_reorder_suggestions)
_read('list_stock_transactions', 'Recent stock movements; filter by item, type (PURCHASE, ISSUE, RETURN, ADJUSTMENT, DISPOSAL) or dates.',
      {**_ITEM, 'transaction_type': {'type': 'string', 'enum': ['PURCHASE', 'ISSUE', 'RETURN', 'ADJUSTMENT', 'DISPOSAL']}, 'date_from': _DATE, 'date_to': _DATE}, list_stock_transactions)
_read('get_item_holders', 'Who currently holds items that were assigned out (all, or for one item).', dict(_ITEM), get_item_holders)

register(Tool(
    name='record_stock_in',
    description=('PREPARE stock coming in: a PURCHASE (default) or a RETURN, several items per card ("20 chairs aur 5 boxes chalk aaye, vendor Ahmad Traders"). '
                 'Quantities are whole numbers. If an item name matches several, ask which. Nothing is recorded until the user approves the card.'),
    parameters={'type': 'object', **_O, 'properties': {'lines': _lines_schema(IN_TYPES), 'date': _DATE, 'vendor_name': {'type': 'string'},
                                                       'reference': {'type': 'string', 'description': 'Bill / invoice number'}, 'remarks': {'type': 'string'}}},
    handler=record_stock_in, sub_agent='operations', module='inventory', roles=ADMINS, kind='write', revise=revise_stock, apply=apply_stock,
))
register(Tool(
    name='record_stock_out',
    description=('PREPARE stock going out: an ISSUE (default) or a DISPOSAL, several items per card ("lab ko 10 markers de diye"). Refused if it would take stock below zero. '
                 'Nothing is recorded until the user approves the card.'),
    parameters={'type': 'object', **_O, 'properties': {'lines': _lines_schema(OUT_TYPES), 'date': _DATE, 'reference': {'type': 'string'}, 'remarks': {'type': 'string'}}},
    handler=record_stock_out, sub_agent='operations', module='inventory', roles=ADMINS, kind='write', revise=revise_stock, apply=apply_stock,
))
