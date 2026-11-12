// Pure logic for the finance manager and Staff screens. The finance manager is read-only on every finance
// API (FinanceRoleAccessPermission), so nothing here builds a write payload.

import { formatMoney } from './feeCollect';

const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

export interface AccountBalance {
  id: number;
  name: string;
  account_type?: string;
  balance?: number | string;
  // The balances endpoint calls it net_balance; the web reads that, so prefer it.
  net_balance?: number | string;
}

export interface RecentEntry {
  type: 'fee_payment' | 'other_income' | 'expense' | 'transfer_in' | 'transfer_out' | string;
  id: number;
  description?: string;
  amount: number | string;
  date?: string | null;
  account_name?: string | null;
  recorded_by?: string | null;
  fee_type_label?: string | null;
}

export interface FeeMonthSummary {
  totalDue: number;
  totalCollected: number;
  totalPending: number;
  // null (not 0) when nothing is due, so the screen can show a dash instead of a fake 0%.
  rate: number | null;
  byClass: Array<{ name: string; due: number; collected: number; rate: number | null }>;
}

export const collectionRate = (collected: number, due: number): number | null =>
  due > 0 ? Math.round((collected / due) * 100) : null;

// Port of normalizeFeeSummary in frontend/src/utils/feeMonthSummary.js (single-school case).
export function normalizeFeeSummary(raw: Record<string, unknown> | null | undefined): FeeMonthSummary | null {
  if (!raw) return null;
  const totalDue = num(raw.total_due as number);
  const totalCollected = num(raw.total_collected as number);
  const byClassRaw = (raw.by_class as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    totalDue,
    totalCollected,
    totalPending: num((raw.total_pending as number) ?? Math.max(0, totalDue - totalCollected)),
    rate: collectionRate(totalCollected, totalDue),
    byClass: byClassRaw.map((c, i) => {
      const due = num(c.total_due as number);
      const collected = num(c.total_collected as number);
      return {
        name: String(c.class_name ?? c.class_obj__name ?? `Class ${i + 1}`),
        due,
        collected,
        rate: collectionRate(collected, due),
      };
    }),
  };
}

// ── Ledger and month filter ───────────────────────────────────────────────────

export interface LedgerEntry {
  id: number; type: string; date: string | null; description: string; school_name?: string | null;
  credit: number | string; debit: number | string; running_balance: number | string;
}

export interface LedgerPayload {
  account?: { id: number; name: string } | null;
  opening_balance: number | string; total_credits: number | string; total_debits: number | string; closing_balance: number | string;
  entries: LedgerEntry[];
}

// Same labels as the web ledger table.
export function ledgerTypeLabel(type: string): string {
  switch (type) {
    case 'fee_payment': return 'Fee payment';
    case 'other_income': return 'Other income';
    case 'expense': return 'Expense';
    case 'transfer_in': return 'Transfer in';
    case 'transfer_out': return 'Transfer out';
    default: return type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  }
}

// First and last day of a month as YYYY-MM-DD.
export function monthRange(year: number, month: number): DateRange {
  const last = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, '0');
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, '0')}` };
}

// The balances endpoint answers { accounts: [...], grand_total, ... } (not a plain list or a
// paged { results }), so the accounts are read from that key.
export function accountsOf(data: unknown): AccountBalance[] {
  if (Array.isArray(data)) return data as AccountBalance[];
  const accounts = (data as { accounts?: unknown } | null | undefined)?.accounts;
  return Array.isArray(accounts) ? (accounts as AccountBalance[]) : [];
}

export const totalBalance = (accounts: AccountBalance[]): number =>
  accounts.reduce((sum, a) => sum + num(a.net_balance ?? a.balance), 0);

export function rateTone(rate: number | null): 'success' | 'warning' | 'error' | 'neutral' {
  if (rate == null) return 'neutral';
  return rate >= 80 ? 'success' : rate >= 50 ? 'warning' : 'error';
}

// Money coming in or going out of the school's accounts. Transfers between accounts count as
// neither on the dashboard feed, so they get a neutral sign.
export function entrySign(type: string): '+' | '-' | '' {
  if (type === 'fee_payment' || type === 'other_income') return '+';
  if (type === 'expense') return '-';
  return '';
}

export function entryAmount(e: Pick<RecentEntry, 'type' | 'amount'>): string {
  return `${entrySign(e.type)}${formatMoney(num(e.amount))}`;
}

export function incomeVsExpense(income: number, expenses: number) {
  const total = income + expenses;
  return {
    net: income - expenses,
    incomePct: total > 0 ? (income / total) * 100 : 0,
    expensePct: total > 0 ? (expenses / total) * 100 : 0,
  };
}

export type Period = 'MONTH' | 'LAST_MONTH' | 'QUARTER' | 'YEAR' | 'CUSTOM';

export interface DateRange { from: string; to: string }

// Date range for the finance summary, as YYYY-MM-DD in local time.
export function periodRange(period: Exclude<Period, 'CUSTOM'>, now = new Date()): DateRange {
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (period === 'QUARTER') {
    return { from: ymd(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)), to: ymd(now) };
  }
  if (period === 'YEAR') return { from: `${now.getFullYear()}-01-01`, to: ymd(now) };
  if (period === 'LAST_MONTH') {
    return { from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: ymd(new Date(now.getFullYear(), now.getMonth(), 0)) };
  }
  return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(now) };
}

// ─── Payslips (own, read-only; the API scopes every non-admin role to their own record) ──────

export interface Payslip {
  id: number;
  month: number;
  year: number;
  basic_salary?: number | string;
  total_allowances?: number | string;
  total_deductions?: number | string;
  net_salary: number | string;
  status: string;
  status_display?: string;
  payment_date?: string | null;
  working_days?: number | null;
  present_days?: number | null;
}

export const sortPayslips = (list: Payslip[]): Payslip[] =>
  [...list].sort((a, b) => b.year - a.year || b.month - a.month);

export function payslipPeriod(p: Pick<Payslip, 'month' | 'year'>): string {
  return new Date(p.year, p.month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

export function payslipTone(status: string): 'success' | 'info' | 'neutral' {
  return status === 'PAID' ? 'success' : status === 'APPROVED' ? 'info' : 'neutral';
}

// ─── Inventory assignments (staff) ─────────────────────────────────────────────────────────

export interface InventoryAssignment {
  id: number;
  item_name: string;
  item_unit?: string;
  quantity: number | string;
  assigned_date?: string | null;
  returned_date?: string | null;
  condition_on_assign_display?: string;
  is_active?: boolean;
  notes?: string;
}

// Items still in the person's hands come first.
export const sortAssignments = (list: InventoryAssignment[]): InventoryAssignment[] =>
  [...list].sort((a, b) =>
    Number(!!b.is_active) - Number(!!a.is_active) || String(b.assigned_date ?? '').localeCompare(String(a.assigned_date ?? '')));

export const PERIOD_LABELS: Record<Period, string> = {
  MONTH: 'This Month', LAST_MONTH: 'Last Month', QUARTER: 'This Quarter', YEAR: 'This Year', CUSTOM: 'Custom',
};

// A custom range is usable only when both ends are set and in order.
export function validRange(from: string, to: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
}

// The range a period stands for; null until a custom range is complete.
export function rangeFor(period: Period, custom: DateRange, now = new Date()): DateRange | null {
  if (period === 'CUSTOM') return validRange(custom.from, custom.to) ? custom : null;
  return periodRange(period, now);
}

export interface TrendMonth { month: number; year: number; income: number | string; expenses: number | string; balance?: number | string }

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Bar heights as a share of the largest value shown, so both series use one scale.
export function trendBars(trend: TrendMonth[]) {
  const rows = trend.map((t) => ({
    label: `${MONTH_SHORT[(t.month - 1 + 12) % 12]} ${String(t.year).slice(2)}`,
    income: num(t.income),
    expenses: num(t.expenses),
  }));
  const max = Math.max(0, ...rows.flatMap((r) => [r.income, r.expenses]));
  return rows.map((r) => ({
    ...r,
    incomePct: max > 0 ? (r.income / max) * 100 : 0,
    expensePct: max > 0 ? (r.expenses / max) * 100 : 0,
  }));
}

export interface ExpenseCategory { category: number | null; category_display: string; total_amount: number | string; count: number }

// Port of the web table: share of the total per category, rounded like the web.
export function categoryShares(categories: ExpenseCategory[], total: number | string) {
  const t = num(total);
  return categories.map((c) => ({
    name: c.category_display || 'Uncategorized',
    amount: num(c.total_amount),
    count: c.count,
    pct: t > 0 ? Math.round((num(c.total_amount) / t) * 100) : 0,
  }));
}

// ── Other income: who may delete an entry ────────────────────────────────────
// The server's rule (can_edit_finance_entry): an admin, or the person who recorded it. The phone hides
// the button for anyone else; the server still decides.
export interface IncomeRow { id: number; category_name?: string | null; description?: string; amount: number | string; date: string; account_name?: string | null; recorded_by?: number | null; recorded_by_name?: string | null }

export function canDeleteIncome(row: Pick<IncomeRow, 'recorded_by'>, userId: number | null | undefined, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  return userId != null && row.recorded_by != null && row.recorded_by === userId;
}

// "Donation, PKR 5,000 on 2026-11-02" for the confirmation.
export function incomeDescription(row: Pick<IncomeRow, 'category_name' | 'description' | 'amount' | 'date'>): string {
  const what = row.category_name || row.description || 'Income';
  return `${what}, ${formatMoney(num(row.amount))} on ${row.date}`;
}
