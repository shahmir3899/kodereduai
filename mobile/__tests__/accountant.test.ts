import {
  collectionRate, entryAmount, entrySign, incomeVsExpense, normalizeFeeSummary, periodRange, rateTone,
  sortAssignments, sortPayslips, totalBalance,
} from '../services/accountant';

describe('fee summary', () => {
  it('normalises totals, pending and per-class rates', () => {
    const s = normalizeFeeSummary({
      total_due: '1000', total_collected: '750',
      by_class: [{ class_name: 'Five', total_due: 400, total_collected: 100 }, { total_due: 0, total_collected: 0 }],
    });
    expect(s).toMatchObject({ totalDue: 1000, totalCollected: 750, totalPending: 250, rate: 75 });
    expect(s?.byClass[0]).toEqual({ name: 'Five', due: 400, collected: 100, rate: 25 });
    expect(s?.byClass[1].name).toBe('Class 2');
    expect(s?.byClass[1].rate).toBeNull();
  });
  it('returns null for no data and a null rate when nothing is due', () => {
    expect(normalizeFeeSummary(null)).toBeNull();
    expect(collectionRate(0, 0)).toBeNull();
    expect(rateTone(null)).toBe('neutral');
    expect(rateTone(80)).toBe('success');
    expect(rateTone(50)).toBe('warning');
    expect(rateTone(49)).toBe('error');
  });
});

describe('ledger helpers', () => {
  it('signs entries by direction and leaves transfers unsigned', () => {
    expect(entrySign('fee_payment')).toBe('+');
    expect(entrySign('other_income')).toBe('+');
    expect(entrySign('expense')).toBe('-');
    expect(entrySign('transfer_out')).toBe('');
    expect(entryAmount({ type: 'expense', amount: 1500 })).toBe('-PKR 1,500');
  });
  it('sums balances and splits income against expenses', () => {
    expect(totalBalance([{ id: 1, name: 'a', balance: '100.5' }, { id: 2, name: 'b', balance: 50 }])).toBeCloseTo(150.5);
    expect(incomeVsExpense(300, 100)).toEqual({ net: 200, incomePct: 75, expensePct: 25 });
    expect(incomeVsExpense(0, 0)).toEqual({ net: 0, incomePct: 0, expensePct: 0 });
  });
});

describe('periodRange', () => {
  const now = new Date(2026, 9, 28);
  it('covers this month, last month and the year to date', () => {
    expect(periodRange('MONTH', now)).toEqual({ from: '2026-10-01', to: '2026-10-28' });
    expect(periodRange('LAST_MONTH', now)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(periodRange('YEAR', now)).toEqual({ from: '2026-01-01', to: '2026-10-28' });
  });
  it('rolls January back into last December', () => {
    expect(periodRange('LAST_MONTH', new Date(2026, 0, 15))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });
});

describe('staff lists', () => {
  it('orders payslips newest first', () => {
    const list = sortPayslips([
      { id: 1, month: 3, year: 2026, net_salary: 1, status: 'PAID' },
      { id: 2, month: 1, year: 2027, net_salary: 1, status: 'DRAFT' },
      { id: 3, month: 12, year: 2026, net_salary: 1, status: 'PAID' },
    ]);
    expect(list.map((p) => p.id)).toEqual([2, 3, 1]);
  });
  it('puts items still held before returned ones', () => {
    const list = sortAssignments([
      { id: 1, item_name: 'a', quantity: 1, is_active: false, assigned_date: '2026-05-01' },
      { id: 2, item_name: 'b', quantity: 1, is_active: true, assigned_date: '2026-01-01' },
      { id: 3, item_name: 'c', quantity: 1, is_active: true, assigned_date: '2026-03-01' },
    ]);
    expect(list.map((a) => a.id)).toEqual([3, 2, 1]);
  });
});
