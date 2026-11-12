import { ledgerTypeLabel, monthRange } from '../services/financeManager';

describe('ledgerTypeLabel', () => {
  it('uses the web labels', () => {
    expect(ledgerTypeLabel('fee_payment')).toBe('Fee payment');
    expect(ledgerTypeLabel('other_income')).toBe('Other income');
    expect(ledgerTypeLabel('expense')).toBe('Expense');
    expect(ledgerTypeLabel('transfer_in')).toBe('Transfer in');
    expect(ledgerTypeLabel('transfer_out')).toBe('Transfer out');
  });
  it('makes a readable label for an unknown type', () => {
    expect(ledgerTypeLabel('salary_payment')).toBe('Salary payment');
  });
});

describe('monthRange', () => {
  it('spans the whole month, leap years included', () => {
    expect(monthRange(2026, 3)).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(monthRange(2026, 11)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(monthRange(2028, 2)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange(2026, 2).to).toBe('2026-02-28');
  });
});
