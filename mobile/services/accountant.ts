// Pure logic for the Accountant and Staff screens. The accountant is read-only on every finance
// API (FinanceRoleAccessPermission), so nothing here builds a write payload.

import { formatMoney } from './feeCollect';

const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

export interface AccountBalance {
  id: number;
  name: string;
  account_type?: string;
  balance: number | string;
}

export interface RecentEntry {
  type: 'fee_payment' | 'other_income' | 'expense' | 'transfer_in' | 'transfer_out' | string;
  id: number;
  description?: string;
  amount: number | string;
  date?: string | null;
  account_name?: string | null;
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

export const totalBalance = (accounts: AccountBalance[]): number =>
  accounts.reduce((sum, a) => sum + num(a.balance), 0);

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

export type Period = 'MONTH' | 'LAST_MONTH' | 'YEAR';

// Date range for the finance summary, as YYYY-MM-DD in local time.
export function periodRange(period: Period, now = new Date()): { from: string; to: string } {
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
