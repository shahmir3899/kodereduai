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
