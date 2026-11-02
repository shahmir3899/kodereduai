// Pure logic for account and category management; port of frontend/src/pages/AccountsPage.jsx and the
// expense / monthly / annual category manager modals. Admin and principal only: the server refuses the
// rest, and re-checks every rule here.

export const ACCOUNT_TYPES = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK', label: 'Bank' },
  { value: 'PERSON', label: 'Person' },
] as const;

export interface ManagedAccount {
  id: number;
  name: string;
  account_type: string;
  opening_balance: number | string;
  is_active: boolean;
  staff_visible?: boolean;
}

export interface AccountForm {
  name: string;
  accountType: string;
  openingBalance: string;
  isActive: boolean;
  staffVisible: boolean;
}

export const emptyAccountForm = (): AccountForm => ({ name: '', accountType: 'CASH', openingBalance: '', isActive: true, staffVisible: true });

export const accountToForm = (a: ManagedAccount): AccountForm => ({
  name: a.name,
  accountType: a.account_type,
  openingBalance: a.opening_balance == null ? '' : String(a.opening_balance),
  isActive: a.is_active !== false,
  staffVisible: a.staff_visible !== false,
});

export function validateAccount(f: AccountForm): string | null {
  if (!f.name.trim()) return 'Enter the account name.';
  if (f.openingBalance.trim() && !Number.isFinite(Number(f.openingBalance))) return 'The opening balance must be a number.';
  return null;
}

// The web sends opening_balance 0 when the box is empty; is_active is only sent on edit.
export function buildAccountPayload(f: AccountForm, editing: boolean): Record<string, unknown> {
  return {
    name: f.name.trim(),
    account_type: f.accountType,
    opening_balance: f.openingBalance.trim() ? Number(f.openingBalance) : 0,
    staff_visible: f.staffVisible,
    ...(editing ? { is_active: f.isActive } : {}),
  };
}

// ─── Categories ────────────────────────────────────────────────────────────────────────────

export type CategoryKind = 'expense' | 'income' | 'monthly' | 'annual';

export const CATEGORY_TABS: Array<{ value: CategoryKind; label: string }> = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'monthly', label: 'Monthly fee' },
  { value: 'annual', label: 'Annual fee' },
];

export interface ManagedCategory {
  id: number;
  name: string;
  description?: string;
  code?: string;
  is_active?: boolean;
  // Only the expense list carries it, and only for admins; absent means the role cannot set it.
  is_sensitive?: boolean;
}

export interface CategoryForm {
  name: string;
  description: string;
  isSensitive: boolean;
}

export const emptyCategoryForm = (): CategoryForm => ({ name: '', description: '', isSensitive: false });

export const categoryToForm = (c: ManagedCategory): CategoryForm => ({
  name: c.name, description: c.description ?? '', isSensitive: !!c.is_sensitive,
});

// Fee categories carry a description, expense ones the sensitive flag, income ones only a name.
export const hasDescription = (kind: CategoryKind) => kind === 'monthly' || kind === 'annual';

// The web only shows the Sensitive switch when the server sent the field (admin only).
export function canSetSensitive(kind: CategoryKind, rows: ManagedCategory[]): boolean {
  return kind === 'expense' && (rows.length === 0 || 'is_sensitive' in rows[0]);
}

export function validateCategory(f: CategoryForm): string | null {
  return f.name.trim() ? null : 'Enter a name.';
}

export function buildCategoryPayload(kind: CategoryKind, f: CategoryForm, rows: ManagedCategory[]): Record<string, unknown> {
  const data: Record<string, unknown> = { name: f.name.trim() };
  if (hasDescription(kind)) data.description = f.description.trim();
  if (canSetSensitive(kind, rows)) data.is_sensitive = f.isSensitive;
  return data;
}

export interface CategorySuggestion { name: string; description?: string }

// Suggestions come back as { suggestions: [{ name, description }] }.
export function suggestionsOf(data: unknown): CategorySuggestion[] {
  const list = (data as { suggestions?: unknown } | null)?.suggestions;
  return Array.isArray(list) ? list.filter((s): s is CategorySuggestion => !!s && typeof (s as CategorySuggestion).name === 'string') : [];
}

export const categoryNoun = (kind: CategoryKind) =>
  kind === 'expense' ? 'expense category' : kind === 'income' ? 'income category' : kind === 'monthly' ? 'monthly fee category' : 'annual fee category';
