import { formFromReply, languageOptions, preferencesError, preferencesPayload } from '../services/assistantPreferences';

describe('Aura preferences', () => {
  it('reads the saved values, with "same as I write" when nothing is saved', () => {
    expect(formFromReply(undefined)).toEqual({ language: 'auto', defaultClass: '', account: null });
    expect(formFromReply({ preferences: { language: 'ur', default_class: '5A', default_account_id: 4 } }))
      .toEqual({ language: 'ur', defaultClass: '5A', account: 4 });
  });

  it('lists the languages the server offers, with friendly names', () => {
    expect(languageOptions({ languages: { auto: 'x', en: 'y' } })).toEqual([
      { value: 'auto', label: 'Same as I write' }, { value: 'en', label: 'English' },
    ]);
    expect(languageOptions(undefined).map((o) => o.value)).toEqual(['auto', 'en', 'ur', 'roman']);
  });

  it('sends the account only to people who have accounts, and empty means forget', () => {
    const form = { language: 'en', defaultClass: '  5A ', account: null };
    expect(preferencesPayload(form, false)).toEqual({ language: 'en', default_class: '5A' });
    expect(preferencesPayload(form, true)).toEqual({ language: 'en', default_class: '5A', default_account_id: '' });
    expect(preferencesPayload({ ...form, account: 7 }, true).default_account_id).toBe(7);
  });

  it("shows the server's reason", () => {
    expect(preferencesError({ response: { data: { error: 'Unknown class.' } } })).toBe('Unknown class.');
    expect(preferencesError(new Error('x'))).toBe('Could not save. Please try again.');
  });
});
