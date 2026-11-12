import { accountsOf, totalBalance } from '../services/financeManager';

describe('accountsOf', () => {
  const payload = {
    accounts: [
      { id: 22, name: 'Bank Account', account_type: 'BANK', net_balance: 50000 },
      { id: 10, name: 'Cash Desk', account_type: 'CASH', net_balance: 229025 },
    ],
    grand_total: 279025,
    date_from: null,
    date_to: null,
  };
  it('reads the accounts key the balances endpoint uses', () => {
    expect(accountsOf(payload).map((a) => a.id)).toEqual([22, 10]);
    expect(totalBalance(accountsOf(payload))).toBe(279025);
  });
  it('also accepts a plain list and tolerates anything else', () => {
    expect(accountsOf([{ id: 1, name: 'x' }])).toHaveLength(1);
    expect(accountsOf(null)).toEqual([]);
    expect(accountsOf({ results: [] })).toEqual([]);
    expect(accountsOf({ accounts: 'nope' })).toEqual([]);
  });
});
