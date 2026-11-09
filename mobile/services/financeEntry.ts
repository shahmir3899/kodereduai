// The expense and income entry forms. The server wants the category and account as ids (the web
// form posts the same), and an account is required because that is where the balance moves.

export type EntryKind = 'expense' | 'income';

export interface EntryForm {
  category: number | null;
  account: number | null;
  amount: string;
  date: string;
  description: string;
  sensitive: boolean;
}

export const emptyEntry = (date: string): EntryForm => ({ category: null, account: null, amount: '', date, description: '', sensitive: false });

// First problem to show, in the order the web form checks them (account, then category); null when fine.
export function validateEntry(f: EntryForm): string | null {
  if (!f.account) return 'Please select an account.';
  if (!f.category) return 'Please select a category.';
  const amount = parseFloat(f.amount);
  if (!f.amount || isNaN(amount) || amount <= 0) return 'Please enter a valid amount.';
  if (!f.date.trim()) return 'Please enter a date.';
  return null;
}

export function entryPayload(kind: EntryKind, f: EntryForm): Record<string, unknown> {
  return {
    category: f.category,
    account: f.account,
    amount: parseFloat(f.amount),
    date: f.date.trim(),
    description: f.description.trim(),
    // Only expenses can be hidden from staff members.
    ...(kind === 'expense' ? { is_sensitive: f.sensitive } : {}),
  };
}

// With a single active account there is nothing to choose, so it is preselected.
export const defaultAccount = (accounts: Array<{ id: number; is_active?: boolean }>): number | null => {
  const active = accounts.filter((a) => a.is_active !== false);
  return active.length === 1 ? active[0].id : null;
};

// A list row as the expense / other-income endpoints return it.
export interface EntryRow {
  id: number; category?: number | null; account?: number | null; amount: number | string; date: string;
  description?: string; is_sensitive?: boolean; recorded_by?: number | null;
}

// Prefills the editor from a row. The finance API is read-only for every role but the admin roles,
// so the phone offers edit and delete to them only; the server still decides (can_edit_finance_entry).
export const formFromRow = (r: EntryRow): EntryForm => ({
  category: r.category ?? null, account: r.account ?? null, amount: String(Number(r.amount) || ''), date: r.date,
  description: r.description ?? '', sensitive: !!r.is_sensitive,
});

export const canChangeEntry = (isAdmin: boolean, row: Pick<EntryRow, 'recorded_by'>, userId: number | null | undefined): boolean =>
  isAdmin || (userId != null && row.recorded_by != null && row.recorded_by === userId);
