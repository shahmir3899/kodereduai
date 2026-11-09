import type { AccountBalance, RecentEntry } from './accountant';
import type { Tone } from '../components/ui/StatusPill';

// Pure helpers for the admin Finance dashboard; shapes follow the endpoints the web
// FinanceDashboardPage.jsx reads. Money stays in memory only (money query roots).

const num = (v: unknown) => Number(v ?? 0) || 0;
const rate = (collected: number, due: number): number | null => (due > 0 ? Math.round((collected / due) * 100) : null);

export interface AnnualFeeRow { name: string; due: number; collected: number; pending: number; rate: number | null }
export interface FeeSchoolRow { schoolId: number; schoolName: string; due: number; collected: number; pending: number; rate: number | null }
// One shape for the monthly and the annual collection cards. Student counts are monthly only.
export interface AnnualFeeSummary {
  totalDue: number; totalCollected: number; totalPending: number; rate: number | null;
  byCategory: AnnualFeeRow[];
  schools: FeeSchoolRow[];
  counts?: { paid: number; partial: number; unpaid: number };
  isMulti: boolean;
}

const feeRow = (c: Record<string, unknown>) => {
  const due = num(c.total_due);
  const collected = num(c.total_collected);
  return { due, collected, pending: num(c.total_pending ?? Math.max(0, due - collected)), rate: rate(collected, due) };
};

// A multi-school answer wraps the combined numbers in `grand` and lists each school in `schools`,
// as the web normaliser does. Annual fees are stored with month 0 for the year.
export function normalizeFeeCollection(raw: Record<string, unknown> | null | undefined, isMulti: boolean, withCounts = false): AnnualFeeSummary | null {
  const src = (isMulti ? (raw?.grand as Record<string, unknown> | undefined) : raw) ?? null;
  if (!src) return null;
  const cats = (src.by_category as Array<Record<string, unknown>> | undefined) ?? [];
  const schools = isMulti ? ((raw?.schools as Array<Record<string, unknown>> | undefined) ?? []) : [];
  const total = feeRow(src);
  return {
    totalDue: total.due,
    totalCollected: total.collected,
    totalPending: total.pending,
    rate: total.rate,
    byCategory: cats.map((c) => {
      const r = feeRow(c);
      return { name: String(c.category_name ?? 'Uncategorized'), ...r };
    }),
    schools: schools.map((s) => ({ schoolId: num(s.school_id), schoolName: String(s.school_name ?? 'School'), ...feeRow(s) })),
    ...(withCounts ? { counts: { paid: num(src.paid_count), partial: num(src.partial_count), unpaid: num(src.unpaid_count) } } : {}),
    isMulti,
  };
}

export const normalizeAnnualFees = (raw: Record<string, unknown> | null | undefined, isMulti: boolean) => normalizeFeeCollection(raw, isMulti);

export const hasAnnualFees = (s: AnnualFeeSummary | null) => !!s && (s.totalDue > 0 || s.byCategory.length > 0);

export interface BalanceGroup { schoolId: number | null; schoolName: string; accounts: AccountBalance[]; subtotal: number; shared?: boolean }
export interface AllBalances { groups: BalanceGroup[]; grandTotal: number }

// Balances for admins with several schools: one group per school, then the organisation's shared
// accounts, then the combined total.
export function normalizeAllBalances(data: unknown): AllBalances {
  const d = (data ?? {}) as { groups?: Array<Record<string, unknown>>; shared?: { accounts?: AccountBalance[]; subtotal?: unknown }; grand_total?: unknown };
  const groups: BalanceGroup[] = (d.groups ?? []).map((g) => ({
    schoolId: num(g.school_id), schoolName: String(g.school_name ?? 'School'),
    accounts: (g.accounts as AccountBalance[] | undefined) ?? [], subtotal: num(g.subtotal),
  }));
  if ((d.shared?.accounts ?? []).length > 0) {
    groups.push({ schoolId: null, schoolName: 'Shared (Organization)', accounts: d.shared!.accounts!, subtotal: num(d.shared!.subtotal), shared: true });
  }
  return { groups, grandTotal: num(d.grand_total) };
}

export const accountTypeTone = (t?: string): Tone =>
  t === 'CASH' ? 'success' : t === 'BANK' ? 'info' : t === 'PERSON' ? 'warning' : 'neutral';

// Badge text and colour of a Recent Entries row, the same four kinds the web table shows.
export function entryBadge(e: Pick<RecentEntry, 'type' | 'fee_type_label'>): { label: string; tone: Tone } {
  switch (e.type) {
    case 'fee_payment': return { label: e.fee_type_label || 'Fee', tone: 'success' };
    case 'other_income': return { label: 'Income', tone: 'info' };
    case 'expense': return { label: 'Expense', tone: 'error' };
    case 'transfer': return { label: 'Transfer', tone: 'neutral' };
    default: return { label: e.type, tone: 'neutral' };
  }
}

// Only school admins (not principals) see the recent-entries audit list, as on the web.
export const canSeeRecentEntries = (isPrincipal: boolean) => !isPrincipal;

// Several schools (or a super admin) get combined balances and annual fees.
export const hasMultipleSchools = (schoolCount: number, isSuperAdmin: boolean) => schoolCount > 1 || isSuperAdmin;
