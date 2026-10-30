// Exam groups, the date sheet and publishing: port of the web Exams page (DateSheetModal and the
// publish buttons). Pure logic, no React Native imports, so Jest can load it.

export interface GroupExam {
  id: number;
  class_name?: string | null;
  status: string;
  schedule_published_at?: string | null;
  marks_entered_count?: number;
  marks_expected_count?: number;
  marks_entry_complete?: boolean;
}

export interface ExamGroupRow {
  id: number;
  name: string;
  exam_type_name?: string;
  term_name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  classes_count?: number;
  exams?: GroupExam[];
}

export interface Progress { done: number; total: number }

// "Schedule: published for 3 of 8 classes" style progress, as on the web's PublishBadge.
export function groupProgress(exams: GroupExam[] = []): { schedule: Progress; results: Progress } {
  return {
    schedule: { done: exams.filter((e) => !!e.schedule_published_at).length, total: exams.length },
    results: { done: exams.filter((e) => e.status === 'PUBLISHED').length, total: exams.length },
  };
}

export function progressText(label: string, p: Progress, on: string, off: string): string {
  if (p.total === 0) return `${label}: no classes`;
  if (p.done === 0) return `${label}: ${off}`;
  if (p.done === p.total) return `${label}: ${on}`;
  return `${label}: ${on} for ${p.done} of ${p.total} classes`;
}

export type ProgressTone = 'neutral' | 'warning' | 'success';
export const progressTone = (p: Progress): ProgressTone => (p.total === 0 || p.done === 0 ? 'neutral' : p.done === p.total ? 'success' : 'warning');

// Result text for the group-wide actions. Announcing skips classes whose marks are not all entered,
// so the message names them (the server reports them in `skipped`).
export interface PublishReply { published_count?: number; unpublished_count?: number; skipped?: Array<{ class_name?: string | null }> }

export function scheduleReplyText(r: PublishReply, publishing: boolean): string {
  const n = publishing ? r.published_count : r.unpublished_count;
  return `${publishing ? 'Published' : 'Unpublished'} the exam schedule for ${n ?? 'all'} exam(s).`;
}

export function resultsReplyText(r: PublishReply, announcing: boolean): { text: string; partial: boolean } {
  if (!announcing) return { text: `Withdrew results for ${r.unpublished_count ?? 'all'} exam(s).`, partial: false };
  const done = r.published_count ?? 0;
  const skipped = r.skipped ?? [];
  if (skipped.length === 0) return { text: `Announced results for ${done} class(es).`, partial: false };
  const names = skipped.map((s) => s.class_name).filter(Boolean).join(', ');
  return { text: `Announced results for ${done} class(es). Not announced: ${skipped.length} with marks not fully entered${names ? ` (${names})` : ''}.`, partial: true };
}

// A single exam can only be announced once every mark is in (the server refuses otherwise); say so
// before the call instead of after.
export function canAnnounce(e: GroupExam): boolean {
  return e.status !== 'PUBLISHED' && !!e.marks_entry_complete;
}

// ─── Date sheet ────────────────────────────────────────────────────────────────────────────

export interface DateSheetSubjectDto {
  subject_id: number;
  subject_name: string;
  subject_code?: string;
  classes: Array<{
    exam_subject_id: number; exam_id: number; class_name: string;
    exam_date: string | null; start_time: string | null; end_time: string | null;
  }>;
}

export interface DateSheetRow {
  examSubjectId: number;
  subject: string;
  className: string;
  date: string;
  start: string;
  end: string;
}

// 'HH:MM:SS' from the server, 'HH:MM' on screen and in the form.
export const shortTime = (t: string | null | undefined): string => (t ? t.slice(0, 5) : '');

export function toRows(subjects: DateSheetSubjectDto[]): DateSheetRow[] {
  return subjects.flatMap((s) => s.classes.map((c) => ({
    examSubjectId: c.exam_subject_id, subject: s.subject_name, className: c.class_name,
    date: c.exam_date ?? '', start: shortTime(c.start_time), end: shortTime(c.end_time),
  })));
}

// Rows by date for reading the sheet: undated rows last, then by class and subject.
export function sortRows(rows: DateSheetRow[]): DateSheetRow[] {
  return [...rows].sort((a, b) => {
    if (!a.date !== !b.date) return a.date ? -1 : 1;
    return a.date.localeCompare(b.date) || a.className.localeCompare(b.className) || a.subject.localeCompare(b.subject);
  });
}

export const unscheduledCount = (rows: DateSheetRow[]) => rows.filter((r) => !r.date).length;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface DateSheetEdit { date: string; start: string; end: string }

// Dates outside the group's exam period are allowed: the web accepts them too and the server does not
// refuse them (the period is shown on the screen instead).
export function validateDateSheetEdit(e: DateSheetEdit): string | null {
  if (e.start && !TIME.test(e.start)) return 'Start time must look like 09:00 (24-hour).';
  if (e.end && !TIME.test(e.end)) return 'End time must look like 11:30 (24-hour).';
  if (e.start && e.end && e.end <= e.start) return 'The end time must be after the start time.';
  if ((e.start || e.end) && !e.date) return 'Choose the exam date before setting a time.';
  return null;
}

// PATCH body for one row. An empty value sends null so a date or time can be cleared.
export const buildDateSheetEntry = (examSubjectId: number, e: DateSheetEdit) => ({
  exam_subject_id: examSubjectId,
  exam_date: e.date || null,
  start_time: e.start || null,
  end_time: e.end || null,
});

export function subjectsInSheet(rows: DateSheetRow[], subjects: DateSheetSubjectDto[]): Array<{ id: number; name: string }> {
  const have = new Set(rows.map((r) => r.subject));
  return subjects.filter((s) => have.has(s.subject_name)).map((s) => ({ id: s.subject_id, name: s.subject_name }));
}
