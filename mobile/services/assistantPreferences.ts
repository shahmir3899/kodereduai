// What Aura remembers (port of the web PreferencesSheet): reply language, usual class, usual fee
// account. An empty class or account means "forget it"; the account is only sent when the person
// has accounts to choose from (finance roles), as on the web.

export const LANGUAGE_LABELS: Record<string, string> = { auto: 'Same as I write', en: 'English', ur: 'Urdu (اردو)', roman: 'Roman Urdu' };

export interface AuraPreferences { language?: string; default_class?: string; default_account_id?: number | null }
export interface PreferencesReply { preferences?: AuraPreferences; languages?: Record<string, string> | string[]; accounts?: Array<{ id: number; name: string }> }

export interface PreferencesForm { language: string; defaultClass: string; account: number | null }

export const formFromReply = (r: PreferencesReply | undefined): PreferencesForm => ({
  language: r?.preferences?.language || 'auto',
  defaultClass: r?.preferences?.default_class || '',
  account: r?.preferences?.default_account_id ?? null,
});

export function languageOptions(r: PreferencesReply | undefined): Array<{ value: string; label: string }> {
  const keys = Array.isArray(r?.languages) ? r!.languages as string[] : Object.keys(r?.languages || LANGUAGE_LABELS);
  return keys.map((k) => ({ value: k, label: LANGUAGE_LABELS[k] || k }));
}

export function preferencesPayload(form: PreferencesForm, hasAccounts: boolean): Record<string, unknown> {
  return {
    language: form.language,
    default_class: form.defaultClass.trim(),
    ...(hasAccounts ? { default_account_id: form.account ?? '' } : {}),
  };
}

export function preferencesError(e: unknown): string {
  const data = (e as { response?: { data?: { error?: string } } })?.response?.data;
  return data?.error || 'Could not save. Please try again.';
}
