import {
  accountToForm, buildAccountPayload, buildCategoryPayload, canSetSensitive, categoryToForm, emptyAccountForm, emptyCategoryForm,
  bankSummary, maskAccountNumber, suggestionsOf, validateAccount, validateCategory,
} from '../services/financeSetup';

describe('account form', () => {
  it('needs a name and a numeric opening balance', () => {
    expect(validateAccount(emptyAccountForm())).toMatch(/name/);
    expect(validateAccount({ ...emptyAccountForm(), name: 'Cash', openingBalance: 'abc' })).toMatch(/number/);
    expect(validateAccount({ ...emptyAccountForm(), name: 'Cash', openingBalance: '' })).toBeNull();
  });
  it('sends 0 for an empty balance and is_active only when editing', () => {
    const f = { ...emptyAccountForm(), name: ' Bank ', accountType: 'BANK' };
    const blankBank = { bank_name: '', account_title: '', account_number: '', iban: '' };
    expect(buildAccountPayload(f, false)).toEqual({ name: 'Bank', account_type: 'BANK', opening_balance: 0, staff_visible: true, ...blankBank });
    expect(buildAccountPayload({ ...f, openingBalance: '2500.5', isActive: false }, true))
      .toEqual({ name: 'Bank', account_type: 'BANK', opening_balance: 2500.5, staff_visible: true, ...blankBank, is_active: false });
  });
  it('loads an account into the form', () => {
    expect(accountToForm({ id: 1, name: 'Petty', account_type: 'CASH', opening_balance: '100.00', is_active: false, staff_visible: false }))
      .toEqual({ name: 'Petty', accountType: 'CASH', openingBalance: '100.00', isActive: false, staffVisible: false, bankName: '', accountTitle: '', accountNumber: '', iban: '' });
  });
});

describe('bank details on an account', () => {
  const bank = { ...emptyAccountForm(), name: 'Kuickpay Settlement', accountType: 'BANK', bankName: ' HBL ', accountTitle: ' The Focus School ', accountNumber: ' 0123-4567 8901 ', iban: 'PK36 HABB 0000 0123 4567 8901' };

  it('sends them, trimmed, with a Bank account', () => {
    expect(buildAccountPayload(bank, false)).toMatchObject({ bank_name: 'HBL', account_title: 'The Focus School', account_number: '0123-4567 8901', iban: 'PK36 HABB 0000 0123 4567 8901' });
  });
  it('sends none when creating a non-bank account, and clears them when an account is switched away from Bank', () => {
    const cash = { ...bank, accountType: 'CASH' };
    expect(buildAccountPayload(cash, false)).not.toHaveProperty('account_number');
    expect(buildAccountPayload(cash, true)).toMatchObject({ bank_name: '', account_title: '', account_number: '', iban: '' });
  });
  it('refuses symbols and markup in the number and IBAN, only for a Bank account', () => {
    expect(validateAccount({ ...bank, accountNumber: '<b>1</b>' })).toMatch(/account number/i);
    expect(validateAccount({ ...bank, iban: 'PK36#1' })).toMatch(/IBAN/);
    expect(validateAccount({ ...bank, accountType: 'CASH', accountNumber: '<b>1</b>' })).toBeNull();
    expect(validateAccount(bank)).toBeNull();
  });
  it('loads the details into the form for editing', () => {
    expect(accountToForm({ id: 2, name: 'B', account_type: 'BANK', opening_balance: 0, is_active: true, bank_name: 'HBL', account_title: 'Title', account_number: '99', iban: 'PK1' }))
      .toMatchObject({ bankName: 'HBL', accountTitle: 'Title', accountNumber: '99', iban: 'PK1' });
  });
  it('masks the number in a list line and copes with a role that is not sent the number', () => {
    expect(maskAccountNumber('0123-4567 8901')).toBe('••••8901');
    expect(maskAccountNumber('')).toBe('');
    expect(bankSummary({ bank_name: 'HBL', account_number: '0123-4567 8901' })).toBe('HBL ••••8901');
    expect(bankSummary({ bank_name: 'HBL' })).toBe('HBL');
    expect(bankSummary({})).toBe('');
  });
});

describe('category form', () => {
  const f = { ...emptyCategoryForm(), name: ' Rent ', description: ' monthly ', isSensitive: true };
  it('needs a name', () => {
    expect(validateCategory(emptyCategoryForm())).toMatch(/name/i);
    expect(validateCategory(f)).toBeNull();
  });
  it('sends the right fields per kind', () => {
    expect(buildCategoryPayload('income', f, [])).toEqual({ name: 'Rent' });
    expect(buildCategoryPayload('monthly', f, [])).toEqual({ name: 'Rent', description: 'monthly' });
    expect(buildCategoryPayload('annual', f, [])).toEqual({ name: 'Rent', description: 'monthly' });
  });
  it('sends the sensitive flag only when the server shows it (admin)', () => {
    expect(buildCategoryPayload('expense', f, [])).toEqual({ name: 'Rent', is_sensitive: true });
    expect(buildCategoryPayload('expense', f, [{ id: 1, name: 'A', is_sensitive: false }])).toEqual({ name: 'Rent', is_sensitive: true });
    expect(canSetSensitive('expense', [{ id: 1, name: 'A' }])).toBe(false);
    expect(buildCategoryPayload('expense', f, [{ id: 1, name: 'A' }])).toEqual({ name: 'Rent' });
    expect(canSetSensitive('income', [])).toBe(false);
  });
  it('loads a category and reads suggestions', () => {
    expect(categoryToForm({ id: 2, name: 'Lab', description: 'x', is_sensitive: true })).toEqual({ name: 'Lab', description: 'x', isSensitive: true });
    expect(suggestionsOf({ suggestions: [{ name: 'Tuition', description: 'd' }, { nope: 1 }] })).toEqual([{ name: 'Tuition', description: 'd' }]);
    expect(suggestionsOf(null)).toEqual([]);
  });
});
