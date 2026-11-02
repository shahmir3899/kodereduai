// Pure helpers for the dashboard cards; port of the web's AttendanceBreakdown / MonthlyFeeCollectionCard.
import type { AttendanceSection, FinanceSection } from './adminDashboard';

export type SegmentKey = 'present_count' | 'leave_count' | 'absent_count' | 'not_marked_count';

// LEAVE is a marked state. Folding it into "not marked" once made the dashboard report students as
// unmarked while the register showed everyone marked.
export const ATTENDANCE_SEGMENTS: ReadonlyArray<{ key: SegmentKey; label: string }> = [
  { key: 'present_count', label: 'Present' },
  { key: 'leave_count', label: 'On leave' },
  { key: 'absent_count', label: 'Absent' },
  { key: 'not_marked_count', label: 'Not marked' },
];

export interface Segment { key: SegmentKey; label: string; count: number; pct: number }

// `?? 0` keeps a payload cached before a field existed from turning into NaN.
export function attendanceSegments(a: Pick<AttendanceSection, 'total_students'> & Partial<AttendanceSection> | null | undefined): Segment[] {
  const total = a?.total_students ?? 0;
  return ATTENDANCE_SEGMENTS.map(({ key, label }) => {
    const count = a?.[key] ?? 0;
    return { key, label, count, pct: total > 0 ? Math.min(100, (count / total) * 100) : 0 };
  });
}

export interface FeeBreakdown {
  collected: number; pending: number; due: number; paid: number; partial: number; unpaid: number; rate: number | null;
}

export function feeBreakdown(f: (FinanceSection & { paid_count?: number }) | null | undefined): FeeBreakdown | null {
  if (!f) return null;
  const due = Number(f.total_due ?? 0);
  const collected = Number(f.total_collected ?? 0);
  return {
    collected, due, pending: Number(f.total_pending ?? Math.max(due - collected, 0)),
    paid: f.paid_count ?? 0, partial: f.partial_count ?? 0, unpaid: f.unpaid_count ?? 0,
    rate: due > 0 ? Math.min(100, Math.round((collected / due) * 100)) : null,
  };
}

export const money = (n: number | string | null | undefined) => `PKR ${Math.round(Number(n || 0)).toLocaleString()}`;

// The header on the home screen: "Wed 30 Oct" style label for the day being viewed.
export function dayHero(opts: { isOffDay: boolean; offTypes?: string[]; rate: number | null; present: number; total: number }): {
  tone: 'blue' | 'green' | 'gray'; title: string; subtitle?: string;
} {
  if (opts.isOffDay) return { tone: 'gray', title: 'No school today', subtitle: opts.offTypes?.length ? opts.offTypes.join(', ') : undefined };
  if (opts.rate == null) return { tone: 'blue', title: 'Attendance not marked yet' };
  return {
    tone: opts.rate >= 90 ? 'green' : 'blue',
    title: `${opts.rate}% present`,
    subtitle: `${opts.present} of ${opts.total} students`,
  };
}
