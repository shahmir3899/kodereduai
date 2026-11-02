// Pure logic for academic years and terms; port of frontend/src/pages/sessions (AcademicYearsPage,
// TermsManager, termDefaults) and components/timeline/timelineMath. Admin and principal only: the
// server refuses the rest and re-checks every rule here. Dates are ISO "YYYY-MM-DD" strings handled
// in UTC so a timezone can never shift a boundary by a day.

const DAY_MS = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Same limits as the server (AcademicYearCreateSerializer): outside them a year is almost always a typo.
export const YEAR_MIN_DAYS = 60;
export const YEAR_MAX_DAYS = 430;
export const SUGGESTED_TERM_DAYS = 90;

export const TERM_TYPES = [
  { value: 'TERM', label: 'Term' },
  { value: 'SEMESTER', label: 'Semester' },
  { value: 'QUARTER', label: 'Quarter' },
] as const;

export interface ManagedYear {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  is_current?: boolean;
  is_active?: boolean;
  terms_count?: number;
  enrollment_count?: number;
}

export interface ManagedTerm {
  id: number;
  academic_year: number;
  name: string;
  term_type: string;
  order: number;
  start_date: string;
  end_date: string;
}

export function dayNumber(iso: string): number {
  if (!iso) return NaN;
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}

export function addDays(iso: string, days: number): string {
  return new Date((dayNumber(iso) + days) * DAY_MS).toISOString().slice(0, 10);
}

// "2026-09-14" -> "14 Sep 2026", the style the server's messages use.
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return String(iso);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// Same rule as the server: two spans clash when one starts before the other ends; touching is fine.
export const spansOverlap = (a: { start_date: string; end_date: string }, b: { start_date: string; end_date: string }) =>
  a.start_date < b.end_date && a.end_date > b.start_date;

// ─── Years ─────────────────────────────────────────────────────────────────────────────────

export interface YearForm { name: string; startDate: string; endDate: string }

export const emptyYearForm = (): YearForm => ({ name: '', startDate: '', endDate: '' });
export const yearToForm = (y: ManagedYear): YearForm => ({ name: y.name, startDate: y.start_date, endDate: y.end_date });

export function validateYear(f: YearForm): string | null {
  if (!f.name.trim()) return 'Enter the year name.';
  if (!f.startDate || !f.endDate) return 'Choose the start and end dates.';
  if (f.startDate >= f.endDate) return 'The end date must be after the start date.';
  return null;
}

// Warnings the server also raises, shown while the admin types: overlap with another year or an odd
// length. `others` excludes the year being edited.
export function yearWarnings(f: Pick<YearForm, 'startDate' | 'endDate'>, others: ManagedYear[]): string[] {
  if (!f.startDate || !f.endDate || f.startDate >= f.endDate) return [];
  const warnings: string[] = [];
  const span = { start_date: f.startDate, end_date: f.endDate };
  const clash = [...others].sort((a, b) => a.start_date.localeCompare(b.start_date)).find((y) => spansOverlap(span, y));
  if (clash) warnings.push(`These dates overlap ${clash.name} (${formatDay(clash.start_date)} - ${formatDay(clash.end_date)}).`);
  const days = dayNumber(f.endDate) - dayNumber(f.startDate);
  if (days < YEAR_MIN_DAYS) warnings.push(`This year is only ${days} days long.`);
  else if (days > YEAR_MAX_DAYS) warnings.push(`This year is ${days} days long, more than a year.`);
  return warnings;
}

// confirm_warnings is sent once the admin has seen the warnings and chosen to save anyway.
export function buildYearPayload(f: YearForm, confirmed: boolean): Record<string, unknown> {
  return { name: f.name.trim(), start_date: f.startDate, end_date: f.endDate, ...(confirmed ? { confirm_warnings: true } : {}) };
}

// Status pills: "Current year", else Past or Upcoming from the dates.
export function yearStatus(y: ManagedYear, today: string): { label: string; tone: 'success' | 'neutral' | 'info' } | null {
  if (y.is_current) return { label: 'Current year', tone: 'success' };
  if (y.end_date && y.end_date < today) return { label: 'Past', tone: 'neutral' };
  if (y.start_date && y.start_date > today) return { label: 'Upcoming', tone: 'info' };
  return null;
}

// The dialog before "Set as current": adds a note for a year that is over or has not started.
export function setCurrentMessage(y: ManagedYear, today: string): string {
  const outside = today < y.start_date ? ' It has not started yet.' : today > y.end_date ? ' It has already ended.' : '';
  return `Set "${y.name}" as the current academic year?${outside}`;
}

// ─── Terms ─────────────────────────────────────────────────────────────────────────────────

export interface TermForm { name: string; termType: string; order: string; startDate: string; endDate: string }

export const termToForm = (t: ManagedTerm): TermForm => ({
  name: t.name, termType: t.term_type, order: String(t.order), startDate: t.start_date || '', endDate: t.end_date || '',
});

// The first term of a year starts on the year's first day, each later one the day after the previous ends.
// start_date is empty when the year is already fully covered.
export function nextTermDefaults(year: ManagedYear, terms: ManagedTerm[]): { order: number; start_date: string } {
  const order = terms.length ? Math.max(...terms.map((t) => Number(t.order) || 0)) + 1 : 1;
  const lastEnd = terms.map((t) => t.end_date).filter(Boolean).sort().pop();
  const start = lastEnd ? addDays(lastEnd, 1) : year.start_date;
  return { order, start_date: start && start <= year.end_date ? start : '' };
}

export function newTermForm(year: ManagedYear, terms: ManagedTerm[]): TermForm | null {
  const next = nextTermDefaults(year, terms);
  if (!next.start_date) return null;
  const end = addDays(next.start_date, SUGGESTED_TERM_DAYS - 1);
  return {
    name: `Term ${next.order}`, termType: 'TERM', order: String(next.order),
    startDate: next.start_date, endDate: end > year.end_date ? year.end_date : end,
  };
}

// Blocking problems: the term cannot be saved at all.
export function validateTerm(f: TermForm, year: ManagedYear): string | null {
  if (!f.name.trim()) return 'Enter the term name.';
  if (!f.startDate || !f.endDate) return 'Choose the start and end dates.';
  if (f.startDate >= f.endDate) return 'The end date must be after the start date.';
  if (f.startDate < year.start_date || f.endDate > year.end_date) {
    return `A term must fall inside the year (${formatDay(year.start_date)} - ${formatDay(year.end_date)}).`;
  }
  return null;
}

// Overlap is only a warning: the admin can save anyway.
export function termClashes(f: TermForm, others: ManagedTerm[]): ManagedTerm[] {
  const span = { start_date: f.startDate, end_date: f.endDate };
  return others.filter((t) => spansOverlap(span, t));
}

export function buildTermPayload(f: TermForm, yearId: number | null, confirmed: boolean): Record<string, unknown> {
  return {
    ...(yearId != null ? { academic_year: yearId } : {}),
    name: f.name.trim(), term_type: f.termType, order: Number(f.order) || 1,
    start_date: f.startDate, end_date: f.endDate,
    ...(confirmed ? { confirm_warnings: true } : {}),
  };
}

// Position of a span on the year bar, as left and width in percent (the end day counts as a whole day).
export function barSpan(start: string, end: string, rangeStart: string, rangeEnd: string): { left: number; width: number } | null {
  const total = dayNumber(rangeEnd) - dayNumber(rangeStart) + 1;
  if (!(total > 0) || Number.isNaN(dayNumber(start)) || Number.isNaN(dayNumber(end))) return null;
  const clamp = (v: number) => Math.min(100, Math.max(0, v));
  const left = clamp(((dayNumber(start) - dayNumber(rangeStart)) / total) * 100);
  const right = clamp(((dayNumber(end) - dayNumber(rangeStart) + 1) / total) * 100);
  return { left, width: Math.max(0, right - left) };
}

// ─── Server answers ────────────────────────────────────────────────────────────────────────

// The server asks for a confirmation with a 400 holding `confirm_warnings` and the warning texts.
export function warningsToConfirm(error: unknown): string[] | null {
  const data = (error as { response?: { data?: Record<string, unknown> } } | null)?.response?.data;
  if (!data || !data.confirm_warnings) return null;
  const text = [].concat((data.non_field_errors ?? []) as never[]).filter((s) => typeof s === 'string') as string[];
  return text.length ? text : ['Please review this change.'];
}

// ─── Import terms from another year ────────────────────────────────────────────────────────

export const CONFLICT_MODES = [
  { value: 'skip', label: 'Skip existing terms' },
  { value: 'update', label: 'Update existing terms' },
] as const;

export interface ImportForm { sourceYearId: number | null; targetYearId: number | null; conflictMode: string; includeInactive: boolean }

export const emptyImportForm = (targetYearId: number | null): ImportForm =>
  ({ sourceYearId: null, targetYearId, conflictMode: 'skip', includeInactive: false });

export function validateImport(f: ImportForm): string | null {
  if (!f.sourceYearId || !f.targetYearId) return 'Choose the source and target years.';
  if (f.sourceYearId === f.targetYearId) return 'The source and target years must be different.';
  return null;
}

export function buildImportPayload(f: ImportForm): Record<string, unknown> {
  return {
    source_academic_year_id: f.sourceYearId, target_academic_year_id: f.targetYearId,
    conflict_mode: f.conflictMode, include_inactive: f.includeInactive,
  };
}

export interface ImportRow {
  source_term_id: number; name: string; term_type?: string; order?: number; action: string; reason?: string;
  source_start_date?: string; source_end_date?: string; start_date?: string; end_date?: string;
}
export interface ImportPreview {
  counts?: { create?: number; update?: number; skip?: number; conflict?: number };
  terms?: ImportRow[];
}

// Conflicts block the import, and so does a preview that would change nothing.
export function canApplyImport(p: ImportPreview | null): boolean {
  if (!p) return false;
  const c = p.counts ?? {};
  return (c.conflict ?? 0) === 0 && (c.create ?? 0) + (c.update ?? 0) > 0;
}

export function importResultText(data: unknown): string {
  const a = (data as { applied?: { created?: number; updated?: number; skipped?: number } } | null)?.applied ?? {};
  return `Imported terms (${a.created ?? 0} created, ${a.updated ?? 0} updated, ${a.skipped ?? 0} skipped).`;
}
