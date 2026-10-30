// Pure logic for the multi-class exam and date sheet wizard; port of
// frontend/src/pages/examinations/ExamWizard.jsx and ExamGroupWizardCreateSerializer in
// backend/examinations. Admin and principal only. The phone always works in sections (session
// classes of the active academic year), the web's "section mode". The server creates the exam
// group, one exam per class and the date sheet in a single transaction, so a failed run leaves
// nothing behind.

import type { ClassOption } from './attendanceEntry';

export interface ClassSubjectDto { session_class?: number | null; class_obj?: number | null; subject: number; subject_name: string; subject_code?: string }
export interface SubjectChoice { id: number; name: string; code?: string }

export interface WizardDetails {
  name: string;
  examType: number | null;
  term: number | null;
  start: string;
  end: string;
  totalMarks: string;
  passingMarks: string;
  failThreshold: string;
}

export const emptyDetails = (): WizardDetails => ({ name: '', examType: null, term: null, start: '', end: '', totalMarks: '100', passingMarks: '33', failThreshold: '3' });

// "Midterm - Term 1 2026-27": type, term when it is not already in the type name, short year.
export function suggestName(typeName: string | undefined, termName: string | undefined, yearName: string | undefined): string {
  if (!typeName) return '';
  const term = termName && !typeName.toLowerCase().includes(termName.toLowerCase()) ? ` - ${termName}` : '';
  const year = yearName ? ` ${yearName.replace(/^academic\s+year\s*/i, '').trim()}` : '';
  return `${typeName}${term}${year}`.trim();
}

export function validateDetails(d: WizardDetails): string | null {
  if (!d.name.trim()) return 'Enter the exam name.';
  if (!d.examType) return 'Choose the exam type.';
  if (!d.start || !d.end) return 'Choose the first and last exam day; the date sheet is built from them.';
  if (d.end < d.start) return 'The last day is before the first day.';
  if (!(Number(d.totalMarks) > 0)) return 'Total marks must be above zero.';
  if (!(Number(d.passingMarks) >= 0) || Number(d.passingMarks) > Number(d.totalMarks)) return 'Passing marks must be between zero and the total.';
  if (!/^\d+$/.test(d.failThreshold.trim()) || Number(d.failThreshold) < 1) return 'Failed subjects that fail the exam: 1 or more.';
  return null;
}

// Subjects taught in each section, from ClassSubject rows (section-scoped ones only).
export function subjectsBySection(rows: ClassSubjectDto[]): Record<number, SubjectChoice[]> {
  const map: Record<number, SubjectChoice[]> = {};
  for (const r of rows) {
    if (!r.session_class) continue;
    (map[r.session_class] ??= []).push({ id: r.subject, name: r.subject_name, code: r.subject_code });
  }
  for (const list of Object.values(map)) list.sort((a, b) => a.name.localeCompare(b.name));
  return map;
}

// A section newly ticked starts with every subject it has, as on the web.
export function withDefaultSubjects(chosen: Record<number, number[]>, classIds: number[], map: Record<number, SubjectChoice[]>): Record<number, number[]> {
  const next = { ...chosen };
  for (const id of classIds) if (!next[id]) next[id] = (map[id] ?? []).map((s) => s.id);
  return next;
}

export function validateClasses(classIds: number[], chosen: Record<number, number[]>): string | null {
  if (classIds.length === 0) return 'Choose at least one class.';
  const total = classIds.reduce((n, id) => n + (chosen[id]?.length ?? 0), 0);
  if (total === 0) return 'Choose at least one subject for at least one class.';
  return null;
}

export interface Pair { key: string; classId: number; className: string; subjectId: number; subjectName: string }
export interface Slot { date: string; start?: string; end?: string }
export type DateSheet = Record<string, Slot>;

export const pairKey = (classId: number, subjectId: number) => `${classId}_${subjectId}`;

// Every class and subject that will be examined, subject name first like the web grid.
export function buildPairs(classIds: number[], chosen: Record<number, number[]>, map: Record<number, SubjectChoice[]>, labels: Record<number, string>): Pair[] {
  const pairs: Pair[] = [];
  for (const classId of classIds) {
    for (const s of map[classId] ?? []) {
      if ((chosen[classId] ?? []).includes(s.id)) pairs.push({ key: pairKey(classId, s.id), classId, className: labels[classId] ?? `Class ${classId}`, subjectId: s.id, subjectName: s.name });
    }
  }
  return pairs.sort((a, b) => a.subjectName.localeCompare(b.subjectName) || a.className.localeCompare(b.className));
}

const toUtc = (d: string) => { const [y, m, day] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, day)); };
const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => { const dt = toUtc(d); dt.setUTCDate(dt.getUTCDate() + n); return fmt(dt); };
export const isSunday = (d: string) => toUtc(d).getUTCDay() === 0;

// Exam days from the start date, skipping Sundays.
export function examDays(start: string, count: number): string[] {
  const days: string[] = [];
  let cursor = start;
  while (days.length < count) {
    if (!isSunday(cursor)) days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

// One day per subject name (the same paper on the same day for every class), in name order,
// Sundays skipped. If the range is too short, it is extended; `extendedTo` says to what.
export function autoFill(pairs: Pair[], start: string, end: string): { sheet: DateSheet; end: string; extendedTo: string | null } {
  const subjects = Array.from(new Set(pairs.map((p) => p.subjectName))).sort((a, b) => a.localeCompare(b));
  const days = examDays(start, subjects.length);
  const dayOf = new Map(subjects.map((s, i) => [s, days[i]]));
  const sheet: DateSheet = {};
  for (const p of pairs) sheet[p.key] = { date: dayOf.get(p.subjectName) as string };
  const last = days[days.length - 1] ?? start;
  const extended = last > end;
  return { sheet, end: extended ? last : end, extendedTo: extended ? last : null };
}

const TIME = /^\d{2}:\d{2}$/;

export function validateSheet(sheet: DateSheet, start: string, end: string): string | null {
  for (const slot of Object.values(sheet)) {
    if (!slot.date) continue;
    if (slot.date < start || slot.date > end) return `${slot.date} is outside ${start} to ${end}.`;
    if (slot.start && !TIME.test(slot.start)) return 'Times are written like 09:00.';
    if (slot.end && !TIME.test(slot.end)) return 'Times are written like 11:30.';
    if (slot.start && slot.end && slot.end <= slot.start) return 'An exam ends before it starts.';
  }
  return null;
}

export const scheduledCount = (sheet: DateSheet) => Object.values(sheet).filter((s) => s.date).length;

export function buildWizardPayload(
  d: WizardDetails, academicYearId: number, classIds: number[], chosen: Record<number, number[]>, sheet: DateSheet,
) {
  return {
    academic_year: academicYearId,
    term: d.term,
    exam_type: d.examType,
    name: d.name.trim(),
    start_date: d.start || null,
    end_date: d.end || null,
    session_class_ids: classIds,
    class_subjects: classIds.map((id) => ({ session_class_id: id, subject_ids: chosen[id] ?? [] })),
    default_total_marks: Number(d.totalMarks) || 100,
    default_passing_marks: Number(d.passingMarks) || 33,
    fail_threshold_subjects: Number(d.failThreshold) || 3,
    date_sheet: Object.entries(sheet)
      .filter(([, s]) => s.date)
      .map(([key, s]) => {
        const [sessionClass, subject] = key.split('_').map(Number);
        return { session_class_id: sessionClass, subject_id: subject, exam_date: s.date, start_time: s.start || null, end_time: s.end || null };
      }),
  };
}

// 409 from the server: some of the classes already have this kind of exam this term.
export function conflictText(data: { detail?: string; conflicts?: Array<{ class_name: string; existing_exam: string }> } | undefined): string | null {
  if (!data?.conflicts?.length) return null;
  const list = data.conflicts.map((c) => `${c.class_name} (already in "${c.existing_exam}")`).join(', ');
  return `These classes already have an exam of this type for this term: ${list}. Untick them, or change the term or type.`;
}

export const sectionLabels = (options: ClassOption[]): Record<number, string> =>
  Object.fromEntries(options.filter((o) => o.isSession).map((o) => [o.id, o.label]));
