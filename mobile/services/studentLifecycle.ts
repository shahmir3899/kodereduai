import { parsePhone } from './studentForm';

// Pure logic for the student profile's admin actions: marking Graduated or Repeat, the enrollment
// history and exit banner, the parent invite, and the student report period. The server decides
// what is allowed (removal-preview lists the outcomes), so nothing here gates access.

// ── Status: Graduated and Repeat ────────────────────────────────────────────

export const SIMPLE_OUTCOMES: Array<{ value: 'GRADUATED' | 'REPEAT'; label: string; hint: string }> = [
  { value: 'GRADUATED', label: 'Graduated', hint: 'Completed the highest class. Still visible in the year they graduated.' },
  { value: 'REPEAT', label: 'Repeat', hint: 'Stays in the same class level next year.' },
];

const WEB_ONLY: Record<string, string> = { LEFT: 'Left school', TRANSFERRED: 'Transferred', READMIT: 'Re-admit' };

// Of the outcomes the server allows for this student, the two a phone can apply.
export const offeredOutcomes = (allowed: string[] | undefined) =>
  SIMPLE_OUTCOMES.filter((o) => (allowed ?? []).includes(o.value));

// The others go through a checklist (fees, library books, gate passes): the Leaving / Transfer and Re-admit sheets.
export const webOnlyOutcomes = (allowed: string[] | undefined) =>
  Object.entries(WEB_ONLY).filter(([k]) => (allowed ?? []).includes(k)).map(([, label]) => label);

export function validateOutcome(outcome: string, reason: string): string | null {
  if (!outcome) return 'Choose what happened to the student.';
  if (!reason.trim()) return 'A reason is required.';
  return null;
}

export const buildOutcomePayload = (outcome: string, reason: string) => ({ outcome, reason: reason.trim() });

export interface RemovalPreview { allowed_outcomes?: string[]; has_history?: boolean }

// ── Enrollment history and exit banner ──────────────────────────────────────

export interface Placement { class_name?: string | null; roll_number?: string | null; start_date: string; end_date?: string | null }
export interface EnrollmentRow {
  academic_year_name?: string;
  academic_year?: string;
  class_name?: string | null;
  section?: string | null;
  roll_number?: string | null;
  status?: string;
  placements?: Placement[];
  branch?: string | null;
}
export interface AwayPeriod { start: string; end: string | null; reason?: string | null }

// The endpoint returns a list, or { enrollments } in an older shape.
export function enrollmentRows(data: unknown): EnrollmentRow[] {
  if (Array.isArray(data)) return data as EnrollmentRow[];
  const inner = (data as { enrollments?: unknown } | null | undefined)?.enrollments;
  return Array.isArray(inner) ? (inner as EnrollmentRow[]) : [];
}

export const enrollmentTitle = (e: EnrollmentRow) => e.academic_year_name || e.academic_year || 'Year';
export const enrollmentLine = (e: EnrollmentRow) =>
  [e.class_name, e.section && e.section !== e.class_name ? `Section ${e.section}` : null, e.roll_number ? `Roll ${e.roll_number}` : null]
    .filter(Boolean).join('  ·  ');

export function enrollmentTone(status?: string): 'success' | 'info' | 'neutral' {
  return status === 'ACTIVE' ? 'success' : status === 'PROMOTED' ? 'info' : 'neutral';
}

// A year with a mid-year move lists each class and roll by dates. The end date the server sends is
// exclusive (the first day in the next class), so the last day shown is the day before.
function dayBefore(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d - 1));
  return date.toISOString().slice(0, 10);
}

export function placementsLine(e: EnrollmentRow): string | null {
  const list = e.placements ?? [];
  if (list.length < 2) return null;
  return 'Moved during the year: ' + list
    .map((p) => `${p.class_name ?? 'Class'} (roll ${p.roll_number ?? '-'}, ${p.start_date}${p.end_date ? ` to ${dayBefore(p.end_date)}` : ' onward'})`)
    .join(' → ');
}

export const awayLine = (p: AwayPeriod) => `${p.start} to ${p.end ?? 'now'}${p.reason ? `  ·  ${p.reason}` : ''}`;

export interface ExitCase {
  exit_type?: string;
  status?: string;
  leaving_date?: string;
  reason?: string | null;
  destination_school_name?: string | null;
  items?: Array<{ kind: string; kind_label?: string; state?: string; summary?: string | null; waived_by_name?: string | null; waived_at?: string | null; waiver_reason?: string | null }>;
}

// Shown only while the student is actually out: after a re-activation the old exit is history.
export function exitBanner(exit: ExitCase | null | undefined, studentStatus: string | null | undefined):
  { headline: string; reason: string | null; waived: string[] } | null {
  if (!exit || exit.status !== 'FINALIZED' || !['WITHDRAWN', 'TRANSFERRED'].includes(studentStatus ?? '')) return null;
  const verb = exit.exit_type === 'TRANSFERRED' ? 'Transferred' : 'Withdrawn';
  const to = exit.destination_school_name ? ` to ${exit.destination_school_name}` : '';
  const waived = (exit.items ?? []).filter((i) => i.state === 'WAIVED').map((i) =>
    `${i.kind_label ?? i.kind} waived${i.summary ? ` (${i.summary})` : ''}${i.waived_by_name ? ` by ${i.waived_by_name}` : ''}${i.waiver_reason ? `: ${i.waiver_reason}` : ''}`);
  return { headline: `${verb}${to} on ${exit.leaving_date ?? ''}`.trim(), reason: exit.reason || null, waived };
}

// ── Parent invite ───────────────────────────────────────────────────────────

export const RELATIONS = [
  { value: 'FATHER', label: 'Father' },
  { value: 'MOTHER', label: 'Mother' },
  { value: 'GUARDIAN', label: 'Guardian' },
  { value: 'OTHER', label: 'Other' },
];

export function buildInvitePayload(studentId: number, relation: string, phone: string) {
  const p = phone.trim();
  return { student_id: studentId, relation, ...(p ? { parent_phone: parsePhone(p) } : {}) };
}

// The app's parent sign-up has an invite code field, so the message points there and needs no web link.
export function inviteShareText(studentName: string, code: string): string {
  return `Your invite code for ${studentName} on the Education AI parent app is ${code}. Open the app, choose parent registration and enter this code. The code works once.`;
}

// ── Student report period ───────────────────────────────────────────────────

export type ReportPeriod = 'this_month' | 'last_month' | 'this_year' | 'custom';
export const REPORT_PERIODS: Array<{ value: ReportPeriod; label: string }> = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'this_year', label: 'This academic year' },
  { value: 'custom', label: 'Custom dates' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;

// Month presets are whole calendar months; the academic year preset sends the year id instead.
export function reportPeriodParams(
  period: ReportPeriod, today: string, yearId: number | null, custom: { from: string; to: string },
): Record<string, unknown> | { error: string } {
  const [y, m] = today.split('-').map(Number);
  if (period === 'this_month') return { date_from: iso(y, m - 1, 1), date_to: iso(y, m - 1, new Date(y, m, 0).getDate()) };
  if (period === 'last_month') {
    const py = m === 1 ? y - 1 : y;
    const pm0 = m === 1 ? 11 : m - 2;
    return { date_from: iso(py, pm0, 1), date_to: iso(py, pm0, new Date(py, pm0 + 1, 0).getDate()) };
  }
  if (period === 'this_year') return yearId != null ? { academic_year: yearId } : { error: 'There is no current academic year.' };
  if (!custom.from || !custom.to) return { error: 'Choose both dates.' };
  if (custom.from > custom.to) return { error: 'The end date cannot be before the start date.' };
  return { date_from: custom.from, date_to: custom.to };
}

export const buildReportRequest = (studentId: number, params: Record<string, unknown>) =>
  ({ report_type: 'STUDENT_COMPREHENSIVE', parameters: { student_id: studentId, ...params } });

export const studentReportFileName = (name: string) =>
  `${(name || 'student').trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'student'}-report.pdf`;
