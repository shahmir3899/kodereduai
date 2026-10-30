import {
  assignableUsers, buildAssignmentPayload, buildItemPayload, buildMovementPayload, emptyAssignForm, emptyItemForm,
  emptyMovementForm, inventoryErrorMessage, itemToForm, signedQuantity, sortAssignmentsList, stockoutText,
  stockStatus, validateAssignment, validateItem, validateMovement, type Item,
} from '../services/inventory';

const item = (over: Partial<Item> = {}): Item => ({
  id: 1, name: 'Chalk', category: 2, unit: 'BOX', current_stock: 10, minimum_stock: 5, unit_price: '12.50', is_active: true, ...over,
});

describe('stock status', () => {
  it('uses the web thresholds: out at zero or below, low up to the minimum', () => {
    expect(stockStatus({ current_stock: 0, minimum_stock: 5 })).toBe('out');
    expect(stockStatus({ current_stock: -2, minimum_stock: 5 })).toBe('out');
    expect(stockStatus({ current_stock: 5, minimum_stock: 5 })).toBe('low');
    expect(stockStatus({ current_stock: 6, minimum_stock: 5 })).toBe('ok');
  });
});

describe('movements', () => {
  const form = (over: Record<string, unknown> = {}) => ({ ...emptyMovementForm('2026-10-28'), item: 1, quantity: '4', ...over });

  it('signs the quantity by type: purchase in, disposal out, adjustment as typed', () => {
    expect(signedQuantity('PURCHASE', 4)).toBe(4);
    expect(signedQuantity('DISPOSAL', 4)).toBe(-4);
    expect(signedQuantity('ADJUSTMENT', -3)).toBe(-3);
    expect(signedQuantity('ADJUSTMENT', 3)).toBe(3);
  });
  it('rejects a missing item, a bad quantity and zero', () => {
    expect(validateMovement(form({ item: null }), null)).toMatch(/item/);
    expect(validateMovement(form({ quantity: '2.5' }), null)).toMatch(/whole number/);
    expect(validateMovement(form({ quantity: 'abc' }), null)).toMatch(/whole number/);
    expect(validateMovement(form({ quantity: '0' }), null)).toMatch(/zero/);
  });
  it('allows a minus sign only on an adjustment', () => {
    expect(validateMovement(form({ quantity: '-4' }), item())).toMatch(/minus/);
    expect(validateMovement(form({ type: 'ADJUSTMENT', quantity: '-4' }), item())).toBeNull();
  });
  it('refuses taking out more than is in stock, for disposal and a downward adjustment', () => {
    expect(validateMovement(form({ type: 'DISPOSAL', quantity: '11' }), item())).toMatch(/Available: 10/);
    expect(validateMovement(form({ type: 'ADJUSTMENT', quantity: '-11' }), item())).toMatch(/Available: 10/);
    expect(validateMovement(form({ type: 'DISPOSAL', quantity: '10' }), item())).toBeNull();
    expect(validateMovement(form({ type: 'PURCHASE', quantity: '500' }), item())).toBeNull();
  });
  it('checks price and date', () => {
    expect(validateMovement(form({ unitPrice: '-1' }), item())).toMatch(/price/);
    expect(validateMovement(form({ date: '' }), item())).toMatch(/date/);
  });
  it('builds the payload: vendor only on a purchase, price falls back to the item price', () => {
    expect(buildMovementPayload(form({ type: 'PURCHASE', vendor: 9, reference: ' INV-1 ' }), '12.5')).toEqual({
      item: 1, transaction_type: 'PURCHASE', quantity: 4, unit_price: 12.5, vendor: 9,
      reference_number: 'INV-1', remarks: '', date: '2026-10-28',
    });
    const disposal = buildMovementPayload(form({ type: 'DISPOSAL', vendor: 9, unitPrice: '3' }));
    expect(disposal).toMatchObject({ quantity: -4, unit_price: 3, vendor: null });
  });
});

describe('items', () => {
  it('requires a name, whole-number stocks and a price', () => {
    const f = { ...emptyItemForm(), name: 'Marker' };
    expect(validateItem({ ...f, name: ' ' }, true)).toMatch(/name/);
    expect(validateItem({ ...f, openingStock: '-1' }, true)).toMatch(/Opening stock/);
    expect(validateItem({ ...f, minimumStock: '1.5' }, true)).toMatch(/Minimum stock/);
    expect(validateItem({ ...f, unitPrice: '' }, true)).toMatch(/price/);
    expect(validateItem(f, true)).toBeNull();
  });
  it('does not ask for opening stock when editing, and never sends it', () => {
    const f = { ...emptyItemForm(), name: 'Marker', openingStock: 'garbage' };
    expect(validateItem(f, false)).toBeNull();
    expect(buildItemPayload(f, false)).not.toHaveProperty('current_stock');
    expect(buildItemPayload({ ...f, openingStock: '7' }, true)).toMatchObject({ current_stock: 7, minimum_stock: 5, unit: 'PCS' });
  });
  it('round-trips an item through the form', () => {
    const f = itemToForm(item({ sku: 'CH-1', location: 'Store A' }));
    expect(f).toMatchObject({ name: 'Chalk', sku: 'CH-1', location: 'Store A', unitPrice: '12.5', minimumStock: '5' });
  });
});

describe('assignments', () => {
  const form = (over: Record<string, unknown> = {}) => ({ ...emptyAssignForm('2026-10-28'), item: 1, user: 5, ...over });
  it('needs an item, a person and a quantity within stock', () => {
    expect(validateAssignment(form({ item: null }), null)).toMatch(/item/);
    expect(validateAssignment(form({ user: null }), item())).toMatch(/who/);
    expect(validateAssignment(form({ quantity: '0' }), item())).toMatch(/1 or more/);
    expect(validateAssignment(form({ quantity: '11' }), item())).toMatch(/Available: 10/);
    expect(validateAssignment(form({ quantity: '10' }), item())).toBeNull();
  });
  it('builds the payload the server expects', () => {
    expect(buildAssignmentPayload(form({ quantity: '2', notes: ' laptop ' }))).toEqual({
      item: 1, assigned_to: 5, quantity: 2, assigned_date: '2026-10-28', condition_on_assign: 'GOOD', notes: 'laptop',
    });
  });
  it('lists only active, non-portal users as assignable', () => {
    const users = [
      { id: 1, is_active: true, role: 'TEACHER' }, { id: 2, is_active: false, role: 'STAFF' },
      { id: 3, is_active: true, role: 'STUDENT' }, { id: 4, is_active: true, role: 'PARENT' },
    ];
    expect(assignableUsers(users).map((u) => u.id)).toEqual([1]);
  });
  it('puts items still held first, newest first', () => {
    const list = sortAssignmentsList([
      { id: 1, is_active: false, assigned_date: '2026-09-01' },
      { id: 2, is_active: true, assigned_date: '2026-01-01' },
      { id: 3, is_active: true, assigned_date: '2026-03-01' },
    ]);
    expect(list.map((a) => a.id)).toEqual([3, 2, 1]);
  });
});

describe('reorder text and errors', () => {
  it('describes time to stock-out', () => {
    expect(stockoutText(null)).toBe('No recent usage');
    expect(stockoutText(0)).toBe('Out now');
    expect(stockoutText(1)).toBe('About 1 day left');
    expect(stockoutText(9)).toBe('About 9 days left');
  });
  it('reads the first server message', () => {
    expect(inventoryErrorMessage({ code: 'ERR_NETWORK' })).toMatch(/No connection/);
    expect(inventoryErrorMessage({ response: { status: 403, data: {} } })).toMatch(/role/);
    expect(inventoryErrorMessage({ response: { status: 400, data: { detail: 'This assignment is already returned.' } } })).toBe('This assignment is already returned.');
    expect(inventoryErrorMessage({ response: { status: 400, data: { quantity: ['Not enough stock. Available: 2.'] } } })).toBe('Not enough stock. Available: 2.');
    expect(inventoryErrorMessage({ response: { status: 500, data: '<html>' } }, 'Oops')).toBe('Oops');
    expect(inventoryErrorMessage({ response: { status: 400, data: {} } }, 'Oops')).toBe('Oops');
  });
});
