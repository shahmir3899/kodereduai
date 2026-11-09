import { canChangeEntry, defaultAccount, emptyEntry, entryPayload, formFromRow, validateEntry } from '../services/financeEntry';
import { manageableAccounts } from '../services/accountsAdmin';
import { normalizeFeeCollection } from '../services/financeDashboard';

describe('expense and income entry', () => {
  const ok = { ...emptyEntry('2026-11-07'), account: 3, category: 5, amount: '1500' };

  it('needs an account, then a category, then a positive amount', () => {
    expect(validateEntry({ ...ok, account: null })).toMatch(/account/i);
    expect(validateEntry({ ...ok, category: null })).toMatch(/category/i);
    expect(validateEntry({ ...ok, amount: '0' })).toMatch(/amount/i);
    expect(validateEntry(ok)).toBeNull();
  });

  it('posts ids and a number, and the sensitive flag only for expenses', () => {
    const f = { ...ok, description: ' Chalk ', sensitive: true };
    expect(entryPayload('expense', f)).toEqual({ category: 5, account: 3, amount: 1500, date: '2026-11-07', description: 'Chalk', is_sensitive: true });
    expect(entryPayload('income', f)).not.toHaveProperty('is_sensitive');
  });

  it('preselects only a lone active account', () => {
    expect(defaultAccount([{ id: 1 }, { id: 2, is_active: false }])).toBe(1);
    expect(defaultAccount([{ id: 1 }, { id: 2 }])).toBeNull();
  });
});

describe('editing an entry', () => {
  const row = { id: 9, category: 5, account: 3, amount: '2500.00', date: '2026-11-02', description: 'Paint', is_sensitive: true, recorded_by: 7 };

  it('prefills the form from a list row and builds the same payload back', () => {
    const f = formFromRow(row);
    expect(f).toEqual({ category: 5, account: 3, amount: '2500', date: '2026-11-02', description: 'Paint', sensitive: true });
    expect(validateEntry(f)).toBeNull();
    expect(entryPayload('expense', f)).toMatchObject({ category: 5, account: 3, amount: 2500, is_sensitive: true });
  });

  it('keeps the old account and category empty rather than inventing ones', () => {
    expect(formFromRow({ ...row, category: null, account: null })).toMatchObject({ category: null, account: null });
  });

  it('lets an admin change any entry, others only their own', () => {
    expect(canChangeEntry(true, row, 1)).toBe(true);
    expect(canChangeEntry(false, row, 7)).toBe(true);
    expect(canChangeEntry(false, row, 8)).toBe(false);
    expect(canChangeEntry(false, { recorded_by: null }, 8)).toBe(false);
  });
});

describe('fee collection for several schools', () => {
  const raw = {
    grand: { total_due: 1000, total_collected: 600, paid_count: 4, partial_count: 1, unpaid_count: 2, by_category: [{ category_name: 'Tuition', total_due: 1000, total_collected: 600 }] },
    schools: [{ school_id: 1, school_name: 'Main', total_due: 700, total_collected: 500 }, { school_id: 2, school_name: 'City', total_due: 300, total_collected: 100, total_pending: 200 }],
  };

  it('keeps counts and one row per school beside the combined total', () => {
    const s = normalizeFeeCollection(raw, true, true)!;
    expect(s).toMatchObject({ totalDue: 1000, totalPending: 400, rate: 60, counts: { paid: 4, partial: 1, unpaid: 2 } });
    expect(s.schools).toEqual([
      { schoolId: 1, schoolName: 'Main', due: 700, collected: 500, pending: 200, rate: 71 },
      { schoolId: 2, schoolName: 'City', due: 300, collected: 100, pending: 200, rate: 33 },
    ]);
  });

  it('has no school rows for a single school, and no counts for annual', () => {
    const s = normalizeFeeCollection(raw.grand, false)!;
    expect(s.schools).toEqual([]);
    expect(s.counts).toBeUndefined();
  });
});

describe('manage accounts list', () => {
  const list = [{ id: 1, school: 4 }, { id: 2, school: null }, { id: 3 }];
  it('shows a principal only the own-school accounts, everyone else all', () => {
    expect(manageableAccounts(list, true).map((a) => a.id)).toEqual([1]);
    expect(manageableAccounts(list, false)).toHaveLength(3);
  });
});
