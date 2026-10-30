// Transfers between accounts and closing a month; port of the Transfers tab, TransferModal and the
// Close Month dialog on the web Accounts page. Admin and principal only (accountants are read-only).
// Pure logic, no React Native imports.

export interface AccountOption { id: number; name: string; is_active?: boolean; school?: number | null }

export interface TransferRow {
  id: number;
  from_account: number;
  from_account_name?: string;
  to_account: number;
  to_account_name?: string;
  amount: string | number;
  date: string;
  description?: string | null;
}

export interface TransferForm { from: number | null; to: number | null; amount: string; date: string; description: string }

export const emptyTransferForm = (today: string): TransferForm => ({ from: null, to: null, amount: '', date: today, description: '' });

export const transferToForm = (t: TransferRow): TransferForm => ({
  from: t.from_account, to: t.to_account, amount: String(Number(t.amount)), date: t.date, description: t.description ?? '',
});

// A principal moves money out of the school's own accounts only; accounts shared across the
// organisation (no school) can still be paid into. Same rule as the web TransferModal.
export function fromAccountOptions(accounts: AccountOption[], isPrincipal: boolean): AccountOption[] {
  return accounts.filter((a) => a.is_active !== false && (!isPrincipal || (a.school !== null && a.school !== undefined)));
}

export const toAccountOptions = (accounts: AccountOption[]): AccountOption[] => accounts.filter((a) => a.is_active !== false);

export function validateTransfer(f: TransferForm): string | null {
  if (f.from == null) return 'Choose the account the money leaves.';
  if (f.to == null) return 'Choose the account the money goes to.';
  if (f.from === f.to) return 'The two accounts must be different.';
  const amount = Number(f.amount);
  if (f.amount.trim() === '' || !Number.isFinite(amount) || amount <= 0) return 'Enter an amount above zero.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return 'Choose the date of the transfer.';
  return null;
}

export const buildTransferPayload = (f: TransferForm) => ({
  from_account: f.from, to_account: f.to, amount: Number(f.amount), date: f.date, description: f.description.trim(),
});

export function transferTitle(t: Pick<TransferRow, 'from_account_name' | 'to_account_name'>): string {
  return `${t.from_account_name ?? 'Account'} to ${t.to_account_name ?? 'account'}`;
}

export function transferConfirmText(f: TransferForm, accounts: AccountOption[]): string {
  const name = (id: number | null) => accounts.find((a) => a.id === id)?.name ?? 'account';
  return `PKR ${Number(f.amount).toLocaleString()} from ${name(f.from)} to ${name(f.to)} on ${f.date}.`;
}

// ─── Closing a month ───────────────────────────────────────────────────────────────────────

export interface ClosingRow { id: number; year: number; month: number; closed_at?: string; closed_by_name?: string | null; notes?: string }

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (year: number, month: number) => `${MONTH_NAMES[month - 1] ?? '?'} ${year}`;

// Closings come newest first from the server; do not rely on it.
export function lastClosing(closings: ClosingRow[]): ClosingRow | null {
  return [...closings].sort((a, b) => b.year - a.year || b.month - a.month)[0] ?? null;
}

export const isClosed = (closings: ClosingRow[], year: number, month: number) => closings.some((c) => c.year === year && c.month === month);

// The month before today's, the one a school normally closes.
export function defaultCloseMonth(today: string): { year: number; month: number } {
  const [y, m] = today.split('-').map(Number);
  return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
}

// A month that has not ended yet can still receive payments; closing it locks them out.
export function isMonthOver(today: string, year: number, month: number): boolean {
  const [y, m] = today.split('-').map(Number);
  return year < y || (year === y && month < m);
}

export function validateClose(year: number, month: number, today: string, closings: ClosingRow[]): string | null {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return 'Choose a year between 2020 and 2100.';
  if (!Number.isInteger(month) || month < 1 || month > 12) return 'Choose the month.';
  if (isClosed(closings, year, month)) return `${monthLabel(year, month)} is already closed.`;
  if (!isMonthOver(today, year, month)) return `${monthLabel(year, month)} has not finished yet. Close it after its last day.`;
  return null;
}

// The server refuses a close while paid fee records lack a date or an account (400 with detail and
// sample student names); show its words rather than a generic failure.
export function closeFailureText(error: unknown): string {
  const e = error as { response?: { data?: { detail?: string; sample_students?: string[] } } } | null;
  const data = e?.response?.data;
  if (!e?.response) return 'No connection. Connect to the internet and try again.';
  if (data?.detail) {
    const names = (data.sample_students ?? []).filter(Boolean);
    return names.length ? `${data.detail} Examples: ${names.join(', ')}.` : data.detail;
  }
  return 'Could not close the month. Try again.';
}
