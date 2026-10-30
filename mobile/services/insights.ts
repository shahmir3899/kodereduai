// Pure logic for the Insights cards (student risk score, attendance risk, academic risk, staff
// risk); read-only, admin and principal only (IsSchoolAdmin on the server). Each risk endpoint
// scans the school and answers { risk_levels, <list> }; the shapes differ a little, so each is
// turned into the same row here. The server already caches the student score for the day.

export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';

export interface InsightRow {
  id: number;
  name: string;
  subtitle: string;
  severity: Severity | null;
  headline: string;
  details: string[];
  action?: string;
}

export interface InsightSummary {
  total: number;
  atRisk: number;
  levels: Record<Severity, number>;
  rows: InsightRow[];
  // Students or staff with too little history to score.
  notEnoughData: number;
}

type Raw = Record<string, unknown>;
const str = (v: unknown) => (v == null ? '' : String(v));
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));
const pct = (v: unknown) => (v == null || !Number.isFinite(num(v)) ? '–' : `${Math.round(num(v) * 10) / 10}%`);
const words = (v: unknown) => str(v).replace(/_/g, ' ').toLowerCase();

const ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export function sortRows(rows: InsightRow[]): InsightRow[] {
  return [...rows].sort((a, b) => (ORDER[a.severity ?? ''] ?? 3) - (ORDER[b.severity ?? ''] ?? 3) || a.name.localeCompare(b.name));
}

function levelsOf(raw: unknown): Record<Severity, number> {
  const r = (raw ?? {}) as Partial<Record<Severity, number>>;
  return { HIGH: r.HIGH ?? 0, MEDIUM: r.MEDIUM ?? 0, LOW: r.LOW ?? 0 };
}

function summarize(data: Raw | undefined, listKey: string, total: string, toRow: (r: Raw) => InsightRow): InsightSummary {
  const list = ((data?.[listKey] as Raw[] | undefined) ?? []);
  const rows = list.map(toRow);
  const scored = rows.filter((r) => r.severity);
  return {
    total: num(data?.[total]) || 0,
    atRisk: num(data?.at_risk_count) || scored.length,
    levels: levelsOf(data?.risk_levels),
    rows: sortRows(scored),
    notEnoughData: rows.length - scored.length,
  };
}

export const studentRiskSummary = (data: Raw | undefined) => summarize(data, 'students', 'total_students', (r) => ({
  id: num(r.student_id),
  name: str(r.student_name),
  subtitle: str(r.class_name),
  severity: (r.severity as Severity) ?? null,
  headline: `Risk score ${Math.round(num(r.composite_score) || 0)}`,
  details: [
    r.attendance_severity ? `Attendance: ${words(r.attendance_severity)}` : '',
    r.academic_severity ? `Marks: ${words(r.academic_severity)}` : '',
    r.fee_risk_level ? `Fees: ${words(r.fee_risk_level)}` : '',
  ].filter(Boolean),
}));

export const attendanceRiskSummary = (data: Raw | undefined) => summarize(data, 'students', 'total_students', (r) => ({
  id: num(r.student_id),
  name: str(r.student_name),
  subtitle: [str(r.class_name), r.roll_number ? `Roll ${str(r.roll_number)}` : ''].filter(Boolean).join('  ·  '),
  severity: r.insufficient_data ? null : ((r.severity as Severity) ?? null),
  headline: `Attendance ${pct(r.current_rate)}`,
  details: [
    r.trend ? `Trend: ${words(r.trend)}` : '',
    r.predicted_rate_4w != null ? `Expected in 4 weeks: ${pct(r.predicted_rate_4w)}` : '',
    num(r.consecutive_absent_days) > 0 ? `${num(r.consecutive_absent_days)} days absent in a row` : '',
    num(r.excused_leave_days) > 0 ? `${num(r.excused_leave_days)} days on approved leave` : '',
  ].filter(Boolean),
  action: str(r.suggested_action) || undefined,
}));

export const academicRiskSummary = (data: Raw | undefined) => summarize(data, 'students', 'total_students', (r) => ({
  id: num(r.student_id),
  name: str(r.student_name),
  subtitle: [str(r.class_name), r.roll_number ? `Roll ${str(r.roll_number)}` : ''].filter(Boolean).join('  ·  '),
  severity: r.insufficient_data ? null : ((r.severity as Severity) ?? null),
  headline: `Average ${pct(r.current_average)}`,
  details: [
    r.trend ? `Trend: ${words(r.trend)}` : '',
    r.exams_recorded != null ? `${num(r.exams_recorded)} exam${num(r.exams_recorded) === 1 ? '' : 's'} counted` : '',
  ].filter(Boolean),
  action: str(r.suggested_action) || undefined,
}));

export const staffRiskSummary = (data: Raw | undefined) => summarize(data, 'staff', 'total_staff', (r) => ({
  id: num(r.staff_id),
  name: str(r.staff_name),
  subtitle: str(r.department),
  severity: (r.severity as Severity) ?? null,
  headline: `Absent ${pct(r.absence_rate)} of days`,
  details: [
    num(r.leave_days_in_window) > 0 ? `${num(r.leave_days_in_window)} leave days in the window` : '',
    r.absence_trend ? `Trend: ${words(r.absence_trend)}` : '',
    num(r.consecutive_absent_days) > 0 ? `${num(r.consecutive_absent_days)} days absent in a row` : '',
    r.day_pattern ? `Pattern: ${str(r.day_pattern)}` : '',
  ].filter(Boolean),
  action: str(r.suggested_action) || undefined,
}));

export const SEVERITY_TONE: Record<Severity, 'error' | 'warning' | 'info'> = { HIGH: 'error', MEDIUM: 'warning', LOW: 'info' };

// "12 at risk of 480" with the three levels, for the card header.
export function summaryText(s: Pick<InsightSummary, 'total' | 'atRisk' | 'levels'>): string {
  if (s.total === 0 && s.atRisk === 0) return 'Nothing to score yet.';
  return `${s.atRisk} at risk of ${s.total}  ·  ${s.levels.HIGH} high, ${s.levels.MEDIUM} medium, ${s.levels.LOW} low`;
}

export type InsightKind = 'students' | 'attendance' | 'academic' | 'staff';

export const INSIGHT_TABS: Array<{ value: InsightKind; label: string }> = [
  { value: 'students', label: 'Students' }, { value: 'attendance', label: 'Attendance' }, { value: 'academic', label: 'Marks' }, { value: 'staff', label: 'Staff' },
];

// When the server answered from its daily cache it says when; show that so a stale number is not
// mistaken for a fresh scan.
export function cachedText(cachedAt: string | undefined, now = new Date()): string | null {
  if (!cachedAt) return null;
  const d = new Date(cachedAt);
  if (Number.isNaN(d.getTime())) return null;
  const mins = Math.round((now.getTime() - d.getTime()) / 60000);
  if (mins < 1) return 'Updated just now';
  if (mins < 60) return `Updated ${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `Updated ${hours} h ago` : `Updated ${Math.round(hours / 24)} d ago`;
}
