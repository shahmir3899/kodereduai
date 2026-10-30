// Pure logic for the view-only report card screen; port of the helpers in
// frontend/src/pages/examinations/ReportCardPage.jsx, ReportCardMarksTable.jsx and reportCardData.js.
// Product rules (see the report-card-exam-rules note): the LAST exam by end date is the main exam
// and alone drives the result; earlier exams are history. All numbers come from the server.

export const MAX_EXAMS = 4;

export interface ExamRef { id: number; name: string; start_date?: string | null; end_date?: string | null }

// Oldest first by end (else start) date, ties by id: the last one is the main exam.
export function sortExams<T extends ExamRef>(exams: T[]): T[] {
  const when = (e: ExamRef) => e.end_date || e.start_date || '';
  return [...exams].sort((a, b) => when(a).localeCompare(when(b)) || a.id - b.id);
}

// Defaults to the latest exam (the common single-exam card) and drops ticks that no longer apply.
export function normalizeExamSelection(selected: number[], exams: ExamRef[]): number[] {
  if (exams.length === 0) return [];
  const valid = selected.filter((id) => exams.some((e) => e.id === id));
  return valid.length > 0 ? valid : [exams[exams.length - 1].id];
}

// Ticks an exam on or off. At most MAX_EXAMS; ticking one more than that is ignored, and the
// last tick can't be removed (a card needs an exam).
export function toggleExam(selected: number[], id: number): number[] {
  if (selected.includes(id)) return selected.length > 1 ? selected.filter((x) => x !== id) : selected;
  return selected.length >= MAX_EXAMS ? selected : [...selected, id];
}

// "1st Term Exam 2026-27 - Playgroup" -> "1st Term Exam": narrow headers, and the class and year
// are already on the card.
export function shortExamName(name: string | null | undefined): string {
  const text = String(name || '');
  return text
    .replace(/\s+[-–]\s+.*$/, '')
    .replace(/\s*\d{4}\s*[-/]\s*\d{2,4}\s*$/, '')
    .trim() || text;
}

export function formatIssueDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export interface EnrollmentRef { id: number; student: number; student_name: string; roll_number?: string | null }

// Natural roll order ("2" before "10").
export function sortEnrollments<T extends EnrollmentRef>(list: T[]): T[] {
  return [...list].sort((a, b) =>
    String(a.roll_number || '').localeCompare(String(b.roll_number || ''), undefined, { numeric: true, sensitivity: 'base' }));
}

// The student before/after the current one; stays put at either end of the list.
export function adjacentEnrollment<T extends EnrollmentRef>(list: T[], currentId: number | null, delta: -1 | 1): T | null {
  const i = list.findIndex((e) => e.id === currentId);
  if (i < 0) return null;
  return list[i + delta] ?? null;
}

export const PODIUM: Record<number, { label: string; icon: string; bg: string; fg: string }> = {
  1: { label: 'First Position', icon: '🏆', bg: '#fffbeb', fg: '#92400e' },
  2: { label: 'Second Position', icon: '🥈', bg: '#f8fafc', fg: '#334155' },
  3: { label: 'Third Position', icon: '🥉', bg: '#fff7ed', fg: '#9a3412' },
};

export const DEFAULT_SIGNATURE_LABELS: Record<string, string> = {
  class_teacher: 'Class Teacher',
  principal: 'Principal',
  parent: 'Parent',
};

export interface Attendance {
  working_days: number; present: number; absent: number; leave: number; not_marked: number;
  percentage?: number | null; suspect?: boolean; from?: string | null; to?: string | null;
}

// Share of working days for each segment of the attendance bar, as 0..100.
export function attendanceShares(a: Attendance): { present: number; absent: number; leave: number } {
  if (!(a.working_days > 0)) return { present: 0, absent: 0, leave: 0 };
  const share = (n: number) => (n / a.working_days) * 100;
  return { present: share(a.present), absent: share(a.absent), leave: share(a.leave) };
}

export function attendanceNote(a: Attendance): string | null {
  if (!(a.not_marked > 0)) return null;
  if (a.suspect) return `Attendance was not recorded on ${a.not_marked} of ${a.working_days} working days. Check the attendance register before issuing this card.`;
  return `Percentage hidden: ${a.not_marked} working ${a.not_marked === 1 ? 'day has' : 'days have'} no attendance recorded.`;
}

export function stars(rating: number | null | undefined): string {
  const n = Math.max(0, Math.min(5, Math.round(rating || 0)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

export interface ExamMarks { marks_obtained: number | null; total_marks: number | string; is_absent?: boolean }
export interface ReportExam {
  exam_id: number; exam_name: string; is_main?: boolean; weight?: number | null;
  marks?: Record<string, ExamMarks | undefined>;
}

// One exam's cell for a subject: "17/20", "Abs", or a dash.
export function examCell(exam: ReportExam, subjectId: number): string {
  const m = exam.marks?.[subjectId];
  if (!m) return '—';
  if (m.is_absent) return 'Abs';
  return `${m.marks_obtained ?? '—'}/${m.total_marks}`;
}

// "got/of" across the subjects this exam has marks for.
export function examTotal(exam: ReportExam, subjectIds: number[]): string {
  let got = 0;
  let of = 0;
  for (const id of subjectIds) {
    const m = exam.marks?.[id];
    if (!m) continue;
    of += Number(m.total_marks) || 0;
    if (!m.is_absent && m.marks_obtained != null) got += Number(m.marks_obtained);
  }
  return of ? `${got}/${of}` : '—';
}

export function formatPct(v: number | string | null | undefined): string {
  return v == null || v === '' || Number.isNaN(Number(v)) ? '—' : `${Number(v).toFixed(1)}%`;
}

// Class average is marks, or a percent when the card says so.
export function formatClassAvg(v: number | string | null | undefined, unit: string | undefined): string {
  return v == null ? '—' : unit === 'percent' ? `${v}%` : String(v);
}

export function examNote(report: { earlier_exam_names?: string[]; weighted?: boolean; main_exam?: { name?: string } | null }): string | null {
  if (!report.earlier_exam_names?.length) return null;
  return report.weighted
    ? `Weighted result across: ${[...report.earlier_exam_names, report.main_exam?.name].filter(Boolean).join(', ')}`
    : `Result is from ${report.main_exam?.name}. Earlier exams shown for reference: ${report.earlier_exam_names.join(', ')}`;
}

// ── PDF layout and file ──────────────────────────────────────────────────────────────────────────
export type ReportTemplate = 'enhanced' | 'traditional';
export const REPORT_TEMPLATES: Array<{ value: ReportTemplate; label: string }> = [
  { value: 'enhanced', label: 'Enhanced' },
  { value: 'traditional', label: 'Traditional' },
];
export const DEFAULT_TEMPLATE: ReportTemplate = 'enhanced';

// A saved or unknown value falls back to the default rather than asking the server for a layout it
// does not have.
export function normalizeTemplate(value: unknown): ReportTemplate {
  return value === 'traditional' || value === 'enhanced' ? value : DEFAULT_TEMPLATE;
}

// The same query the card itself was loaded with, plus the layout, so the PDF matches the screen.
export function reportCardPdfParams(input: {
  studentId: number; enrollmentId: number | null; yearId: number | null; examIds: number[]; template: ReportTemplate;
}): Record<string, unknown> {
  return {
    student_id: input.studentId,
    enrollment_id: input.enrollmentId || undefined,
    academic_year_id: input.yearId,
    exam_ids: input.examIds.join(','),
    template: input.template,
  };
}

export function reportCardFileName(studentName: string | undefined, template: ReportTemplate): string {
  const name = (studentName || 'Student').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Student';
  return `Report_Card_${name}_${template === 'traditional' ? 'Traditional' : 'Enhanced'}.pdf`;
}

// The server's own words for 400 and 404; the files are fetched as bytes, so the JSON message is
// read out of the bytes.
export function reportCardPdfError(error: unknown): string {
  const e = error as { response?: { status?: number; data?: ArrayBuffer | { detail?: string } } } | null;
  if (!e?.response) return (error as Error)?.message || 'No connection. Connect to the internet and try again.';
  if (e.response.status === 403) return 'Your role cannot print this report card.';
  try {
    const data = e.response.data;
    const parsed = data instanceof ArrayBuffer ? JSON.parse(new TextDecoder().decode(data)) : data;
    if (parsed?.detail) return String(parsed.detail);
  } catch {
    // Not JSON: use the generic text.
  }
  return 'The report card could not be created. Try again in a moment.';
}
