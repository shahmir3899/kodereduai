// Pure logic for the Fee Overview card: a month's collection by category and by class, from the
// server's canonical summary (the endpoint the web Fee Overview uses). Money stays in memory only.

const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

export interface CategoryRow { category_id?: number | null; category_name?: string | null; total_due?: number | string; total_collected?: number | string; count?: number }
export interface ClassRow { class_name?: string | null; students?: number; total_due?: number | string; total_collected?: number | string }
export interface FeeSummaryData {
  total_students?: number; total_due?: number | string; total_collected?: number | string;
  by_category?: CategoryRow[]; by_class?: ClassRow[];
}

export const collectionRate = (due: number, collected: number): number => (due > 0 ? Math.min(100, Math.round((collected / due) * 100)) : 0);

export interface OverviewRow { label: string; due: number; collected: number; pending: number; rate: number; count: number }

export function categoryRows(data: FeeSummaryData | null | undefined): OverviewRow[] {
  return (data?.by_category ?? []).map((c) => {
    const due = num(c.total_due);
    const collected = num(c.total_collected);
    return { label: c.category_name || 'Uncategorized', due, collected, pending: Math.max(0, due - collected), rate: collectionRate(due, collected), count: c.count ?? 0 };
  });
}

export function classRows(data: FeeSummaryData | null | undefined): OverviewRow[] {
  return (data?.by_class ?? []).map((c) => {
    const due = num(c.total_due);
    const collected = num(c.total_collected);
    return { label: c.class_name || 'Class', due, collected, pending: Math.max(0, due - collected), rate: collectionRate(due, collected), count: c.students ?? 0 };
  });
}

// One stacked bar per row for the chart: what was collected and what is still pending.
export function chartBars(rows: OverviewRow[]) {
  return rows.map((r) => ({
    label: r.label.length > 10 ? `${r.label.slice(0, 9)}…` : r.label,
    stacks: [{ value: r.collected, color: '#16a34a' }, { value: r.pending, color: '#fca5a5' }],
  }));
}

export const hasOverview = (data: FeeSummaryData | null | undefined) => categoryRows(data).length > 0 || classRows(data).length > 0;

// Query params of the canonical summary for a month (monthly fees) of the active year.
export function overviewParams(month: number, year: number, academicYearId: number | null) {
  return { month, year, fee_type: 'MONTHLY', ...(academicYearId ? { academic_year: academicYearId } : {}) };
}

// ── Full Fee Overview screen ─────────────────────────────────────────────────

export type OverviewFeeType = 'MONTHLY' | 'ANNUAL';

// Params shared by the summary and the payments list, as the web useFeeOverview builds them: annual
// fees live in month 0, and the category filter is the monthly or the annual one by fee type.
export function screenParams(p: { feeType: OverviewFeeType; month: number; year: number; academicYearId: number | null; categoryId: number | null }) {
  const monthly = p.feeType === 'MONTHLY';
  return {
    month: monthly ? p.month : 0,
    year: p.year,
    fee_type: p.feeType,
    ...(p.categoryId ? { [monthly ? 'monthly_category' : 'annual_category']: p.categoryId } : {}),
    ...(p.academicYearId ? { academic_year: p.academicYearId } : {}),
  };
}

export interface OverviewKpis { students: number; due: number; collected: number; balance: number; rate: number }

export function overviewKpis(data: (FeeSummaryData & { total_pending?: number | string }) | null | undefined): OverviewKpis {
  const due = num(data?.total_due);
  const collected = num(data?.total_collected);
  return {
    students: num(data?.total_students), due, collected,
    balance: data?.total_pending != null ? num(data.total_pending) : Math.max(0, due - collected),
    rate: collectionRate(due, collected),
  };
}

export const STATUS_COLORS = { Paid: '#16a34a', Partial: '#ea580c', Unpaid: '#dc2626', Advance: '#2563eb' } as const;

// The payment-status donut: students paid, partly paid, unpaid and ahead. Empty slices are left out.
export function statusSlices(data: { paid_count?: number; partial_count?: number; unpaid_count?: number; advance_count?: number } | null | undefined) {
  return [
    { text: 'Paid', value: data?.paid_count ?? 0, color: STATUS_COLORS.Paid },
    { text: 'Partial', value: data?.partial_count ?? 0, color: STATUS_COLORS.Partial },
    { text: 'Unpaid', value: data?.unpaid_count ?? 0, color: STATUS_COLORS.Unpaid },
    { text: 'Advance', value: data?.advance_count ?? 0, color: STATUS_COLORS.Advance },
  ].filter((s) => s.value > 0);
}

export interface StudentFee {
  id: number; student: number; student_name: string; student_roll?: string | number | null; class_name?: string;
  status: 'UNPAID' | 'PARTIAL' | 'PAID' | 'ADVANCE'; amount_due: number | string; amount_paid: number | string;
}

export interface ClassGroup<T extends StudentFee = StudentFee> { name: string; rows: T[]; balance: number }

const balanceOfFee = (p: Pick<StudentFee, 'amount_due' | 'amount_paid'>) => num(p.amount_due) - num(p.amount_paid);

// Students grouped by class, in roll-number order within each class, as the web class breakdown.
export function groupByClass<T extends StudentFee>(payments: T[]): ClassGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const p of payments) {
    const name = p.class_name || 'Unknown';
    groups.set(name, [...(groups.get(name) ?? []), p]);
  }
  return [...groups].map(([name, rows]) => ({
    name,
    rows: [...rows].sort((a, b) => (parseInt(String(a.student_roll), 10) || 0) - (parseInt(String(b.student_roll), 10) || 0)),
    balance: rows.reduce((s, r) => s + balanceOfFee(r), 0),
  }));
}

// Who still owes: unpaid and partly paid, by class, with the total owed.
export function pendingStudents<T extends StudentFee>(payments: T[]) {
  const pending = payments.filter((p) => p.status === 'UNPAID' || p.status === 'PARTIAL');
  return { count: pending.length, total: pending.reduce((s, p) => s + balanceOfFee(p), 0), groups: groupByClass(pending) };
}
