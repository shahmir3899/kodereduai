import {
  accountTypeTone, canSeeRecentEntries, entryBadge, hasAnnualFees, hasMultipleSchools, normalizeAllBalances, normalizeAnnualFees,
} from '../services/financeDashboard';
import { healthTiles } from '../services/sessionHealth';

describe('annual fees', () => {
  const raw = {
    total_due: '1000', total_collected: '400',
    by_category: [{ category_name: 'Admission', total_due: 600, total_collected: 600 }, { category_name: null, total_due: 400, total_collected: 0 }],
  };

  it('works out pending and rate, per category too', () => {
    const s = normalizeAnnualFees(raw, false)!;
    expect(s).toMatchObject({ totalDue: 1000, totalCollected: 400, totalPending: 600, rate: 40, isMulti: false });
    expect(s.byCategory[0]).toMatchObject({ name: 'Admission', pending: 0, rate: 100 });
    expect(s.byCategory[1]).toMatchObject({ name: 'Uncategorized', pending: 400, rate: 0 });
  });

  it('reads the combined numbers from grand for several schools', () => {
    const s = normalizeAnnualFees({ grand: raw, schools: [] }, true)!;
    expect(s.totalDue).toBe(1000);
    expect(s.isMulti).toBe(true);
  });

  it('has a null rate, not 0%, when nothing is due, and no card content', () => {
    const s = normalizeAnnualFees({ total_due: 0, total_collected: 0, by_category: [] }, false)!;
    expect(s.rate).toBeNull();
    expect(hasAnnualFees(s)).toBe(false);
    expect(hasAnnualFees(null)).toBe(false);
    expect(normalizeAnnualFees(null, false)).toBeNull();
  });
});

describe('balances for several schools', () => {
  it('lists each school, then the shared accounts, with the grand total', () => {
    const r = normalizeAllBalances({
      groups: [{ school_id: 1, school_name: 'Main', accounts: [{ id: 1, name: 'Cash' }], subtotal: '500' }],
      shared: { accounts: [{ id: 9, name: 'Org bank' }], subtotal: 200 },
      grand_total: 700,
    });
    expect(r.groups.map((g) => g.schoolName)).toEqual(['Main', 'Shared (Organization)']);
    expect(r.groups[1].shared).toBe(true);
    expect(r.grandTotal).toBe(700);
  });

  it('omits an empty shared group and survives a missing body', () => {
    expect(normalizeAllBalances({ groups: [], shared: { accounts: [], subtotal: 0 }, grand_total: 0 }).groups).toEqual([]);
    expect(normalizeAllBalances(undefined)).toEqual({ groups: [], grandTotal: 0 });
  });
});

describe('badges and visibility', () => {
  it('maps account types and entry kinds', () => {
    expect(accountTypeTone('CASH')).toBe('success');
    expect(accountTypeTone('BANK')).toBe('info');
    expect(accountTypeTone('PERSON')).toBe('warning');
    expect(accountTypeTone(undefined)).toBe('neutral');
    expect(entryBadge({ type: 'fee_payment', fee_type_label: 'Monthly' })).toEqual({ label: 'Monthly', tone: 'success' });
    expect(entryBadge({ type: 'fee_payment' }).label).toBe('Fee');
    expect(entryBadge({ type: 'expense' })).toEqual({ label: 'Expense', tone: 'error' });
    expect(entryBadge({ type: 'mystery' })).toEqual({ label: 'mystery', tone: 'neutral' });
  });

  it('shows recent entries to school admins only, and combined views to multi-school users', () => {
    expect(canSeeRecentEntries(false)).toBe(true);
    expect(canSeeRecentEntries(true)).toBe(false);
    expect(hasMultipleSchools(2, false)).toBe(true);
    expect(hasMultipleSchools(1, true)).toBe(true);
    expect(hasMultipleSchools(1, false)).toBe(false);
  });
});

describe('session health tiles', () => {
  it('rounds the four rates and shows a dash for a missing one', () => {
    const t = healthTiles({ enrollment: { retention_rate: 91.6 }, attendance: { average_attendance_rate: 88.2 }, fee_collection: { collection_rate: 0 } });
    expect(t).toEqual([
      { label: 'Retention', value: '92%' }, { label: 'Attendance', value: '88%' },
      { label: 'Fee collection', value: '0%' }, { label: 'Pass rate', value: '—' },
    ]);
  });
});
