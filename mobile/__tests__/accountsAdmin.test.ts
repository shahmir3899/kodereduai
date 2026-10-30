import {
  buildTransferPayload, closeFailureText, defaultCloseMonth, emptyTransferForm, fromAccountOptions, isClosed, isMonthOver, lastClosing,
  monthLabel, toAccountOptions, transferConfirmText, transferTitle, transferToForm, validateClose, validateTransfer, type ClosingRow,
} from '../services/accountsAdmin';

const accounts = [
  { id: 1, name: 'Cash', is_active: true, school: 7 },
  { id: 2, name: 'Org bank', is_active: true, school: null },
  { id: 3, name: 'Old', is_active: false, school: 7 },
];

describe('account choices', () => {
  it('hides inactive accounts, and shared ones as a principal source', () => {
    expect(fromAccountOptions(accounts, false).map((a) => a.id)).toEqual([1, 2]);
    expect(fromAccountOptions(accounts, true).map((a) => a.id)).toEqual([1]);
    expect(toAccountOptions(accounts).map((a) => a.id)).toEqual([1, 2]);
  });
});

describe('transfer form', () => {
  const ok = { from: 1, to: 2, amount: '500', date: '2026-10-30', description: ' petty cash ' };

  it('validates accounts, amount and date', () => {
    expect(validateTransfer(emptyTransferForm('2026-10-30'))).toMatch(/leaves/);
    expect(validateTransfer({ ...ok, to: null })).toMatch(/goes to/);
    expect(validateTransfer({ ...ok, to: 1 })).toMatch(/different/);
    expect(validateTransfer({ ...ok, amount: '0' })).toMatch(/above zero/);
    expect(validateTransfer({ ...ok, amount: 'x' })).toMatch(/above zero/);
    expect(validateTransfer({ ...ok, date: '' })).toMatch(/date/);
    expect(validateTransfer(ok)).toBeNull();
  });

  it('builds the payload, trims the note, and round-trips a saved transfer', () => {
    expect(buildTransferPayload(ok)).toEqual({ from_account: 1, to_account: 2, amount: 500, date: '2026-10-30', description: 'petty cash' });
    expect(transferToForm({ id: 9, from_account: 1, to_account: 2, amount: '500.00', date: '2026-10-30', description: null }))
      .toEqual({ from: 1, to: 2, amount: '500', date: '2026-10-30', description: '' });
  });

  it('words the title and the confirmation', () => {
    expect(transferTitle({ from_account_name: 'Cash', to_account_name: 'Bank' })).toBe('Cash to Bank');
    expect(transferConfirmText(ok, accounts)).toBe('PKR 500 from Cash to Org bank on 2026-10-30.');
  });
});

describe('closing a month', () => {
  const closings: ClosingRow[] = [{ id: 1, year: 2026, month: 8 }, { id: 2, year: 2026, month: 9 }, { id: 3, year: 2025, month: 12 }];

  it('finds the last closing whatever the order', () => {
    expect(lastClosing(closings)).toMatchObject({ year: 2026, month: 9 });
    expect(lastClosing([])).toBeNull();
    expect(isClosed(closings, 2026, 8)).toBe(true);
    expect(isClosed(closings, 2026, 10)).toBe(false);
  });

  it('proposes last month, across the new year', () => {
    expect(defaultCloseMonth('2026-10-30')).toEqual({ year: 2026, month: 9 });
    expect(defaultCloseMonth('2026-01-05')).toEqual({ year: 2025, month: 12 });
  });

  it('only lets a finished, still open month be closed', () => {
    expect(isMonthOver('2026-10-30', 2026, 9)).toBe(true);
    expect(isMonthOver('2026-10-30', 2026, 10)).toBe(false);
    expect(validateClose(2026, 9, '2026-10-30', [])).toBeNull();
    expect(validateClose(2026, 9, '2026-10-30', closings)).toMatch(/already closed/);
    expect(validateClose(2026, 10, '2026-10-30', closings)).toMatch(/not finished/);
    expect(validateClose(2019, 1, '2026-10-30', [])).toMatch(/year/);
    expect(monthLabel(2026, 9)).toBe('September 2026');
  });

  it('shows the server reason, with example students', () => {
    const err = { response: { data: { detail: 'Cannot close 2026/09: 2 fee payment(s) are missing payment_date or account.', sample_students: ['Ali', 'Sara'] } } };
    expect(closeFailureText(err)).toBe('Cannot close 2026/09: 2 fee payment(s) are missing payment_date or account. Examples: Ali, Sara.');
    expect(closeFailureText({ response: { data: {} } })).toMatch(/Could not close/);
    expect(closeFailureText(new Error('x'))).toMatch(/No connection/);
  });
});
