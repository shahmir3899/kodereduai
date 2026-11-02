import {
  accountToForm, buildAccountPayload, buildCategoryPayload, canSetSensitive, categoryToForm, emptyAccountForm, emptyCategoryForm,
  suggestionsOf, validateAccount, validateCategory,
} from '../services/financeSetup';

describe('account form', () => {
  it('needs a name and a numeric opening balance', () => {
    expect(validateAccount(emptyAccountForm())).toMatch(/name/);
    expect(validateAccount({ ...emptyAccountForm(), name: 'Cash', openingBalance: 'abc' })).toMatch(/number/);
    expect(validateAccount({ ...emptyAccountForm(), name: 'Cash', openingBalance: '' })).toBeNull();
  });
  it('sends 0 for an empty balance and is_active only when editing', () => {
    const f = { ...emptyAccountForm(), name: ' Bank ', accountType: 'BANK' };
    expect(buildAccountPayload(f, false)).toEqual({ name: 'Bank', account_type: 'BANK', opening_balance: 0, staff_visible: true });
    expect(buildAccountPayload({ ...f, openingBalance: '2500.5', isActive: false }, true))
      .toEqual({ name: 'Bank', account_type: 'BANK', opening_balance: 2500.5, staff_visible: true, is_active: false });
  });
  it('loads an account into the form', () => {
    expect(accountToForm({ id: 1, name: 'Petty', account_type: 'CASH', opening_balance: '100.00', is_active: false, staff_visible: false }))
      .toEqual({ name: 'Petty', accountType: 'CASH', openingBalance: '100.00', isActive: false, staffVisible: false });
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
