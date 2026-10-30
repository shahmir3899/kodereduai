// Pure logic behind the marks entry screen; mirrors frontend/src/pages/examinations/MarksEntryPage.jsx.

export interface MarkRow {
  studentId: number;
  name: string;
  roll: string;
  // Kept as the text being typed; '' means no mark yet.
  marks: string;
  isAbsent: boolean;
  remarks: string;
}

export interface RosterStudent { id: number; name: string; roll_number?: string | null }
export interface SavedMark {
  student: number;
  student_name?: string;
  student_roll_number?: string | null;
  marks_obtained: number | string | null;
  is_absent: boolean;
  remarks?: string | null;
}
export interface ExamSubjectLite { id: number; subject: number; subject_name: string; total_marks: number | string; passing_marks: number | string }
export interface ExamLite { id: number; name: string; class_obj: number; session_class?: number | null; academic_year: number }

// Numeric roll first (ascending), then text rolls, and students with no roll last.
export function sortByRoll<T extends { roll: string }>(rows: T[]): T[] {
  const parse = (value: string) => {
    const text = String(value || '').trim();
    if (!text) return { empty: true, num: Number.POSITIVE_INFINITY, text: '' };
    const num = Number.parseInt(text, 10);
    return { empty: false, num: Number.isNaN(num) ? Number.POSITIVE_INFINITY : num, text: text.toLowerCase() };
  };
  return [...rows].sort((a, b) => {
    const ra = parse(a.roll);
    const rb = parse(b.roll);
    if (ra.empty !== rb.empty) return ra.empty ? 1 : -1;
    if (ra.num !== rb.num) return ra.num - rb.num;
    return ra.text.localeCompare(rb.text);
  });
}

const markText = (m: SavedMark | undefined) => (m && m.marks_obtained !== null && m.marks_obtained !== undefined ? String(m.marks_obtained) : '');

// Rows come from the current roster with any saved marks filled in. Building them from saved
// marks alone kept students who had since left and dropped anyone without a saved row yet.
// With no roster at all (a legacy class without enrolments) the saved marks are the rows.
export function buildMarkRows(roster: RosterStudent[], saved: SavedMark[]): MarkRow[] {
  if (roster.length > 0) {
    const byStudent = new Map(saved.map((m) => [m.student, m]));
    return sortByRoll(roster.map((s) => {
      const m = byStudent.get(s.id);
      return {
        studentId: s.id,
        name: s.name,
        roll: s.roll_number ? String(s.roll_number) : '',
        marks: markText(m),
        isAbsent: m ? m.is_absent : false,
        remarks: m?.remarks || '',
      };
    }));
  }
  return sortByRoll(saved.map((m) => ({
    studentId: m.student,
    name: m.student_name || 'Student',
    roll: m.student_roll_number ? String(m.student_roll_number) : '',
    marks: markText(m),
    isAbsent: m.is_absent,
    remarks: m.remarks || '',
  })));
}

export function setMarks(rows: MarkRow[], studentId: number, marks: string): MarkRow[] {
  return rows.map((r) => (r.studentId === studentId ? { ...r, marks } : r));
}

// Marking absent clears the mark; unmarking leaves it blank to be typed again.
export function setAbsent(rows: MarkRow[], studentId: number, isAbsent: boolean): MarkRow[] {
  return rows.map((r) => (r.studentId === studentId ? { ...r, isAbsent, marks: isAbsent ? '' : r.marks } : r));
}

export function setRemarks(rows: MarkRow[], studentId: number, remarks: string): MarkRow[] {
  return rows.map((r) => (r.studentId === studentId ? { ...r, remarks } : r));
}

// null when fine. Up to two decimals, like the web's step of 0.01; blank is allowed (not entered yet).
export function validateMark(text: string, total: number): string | null {
  const t = text.trim();
  if (t === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return 'Enter a number';
  if (Number(t) > total) return `Max ${total}`;
  return null;
}

export function validateRows(rows: MarkRow[], total: number): Record<number, string> {
  const errors: Record<number, string> = {};
  for (const r of rows) {
    if (r.isAbsent) continue;
    const e = validateMark(r.marks, total);
    if (e) errors[r.studentId] = e;
  }
  return errors;
}

export type Result = 'pass' | 'fail' | null;
export function resultOf(row: MarkRow, passing: number): Result {
  if (row.isAbsent || row.marks.trim() === '' || Number.isNaN(Number(row.marks))) return null;
  return Number(row.marks) >= passing ? 'pass' : 'fail';
}

export function summarize(rows: MarkRow[], passing: number) {
  let entered = 0;
  let absent = 0;
  let failing = 0;
  for (const r of rows) {
    if (r.isAbsent) absent++;
    else if (r.marks.trim() !== '') {
      entered++;
      if (resultOf(r, passing) === 'fail') failing++;
    }
  }
  return { entered, absent, failing, missing: rows.length - entered - absent };
}

export function isDirty(rows: MarkRow[], baseline: MarkRow[]): boolean {
  if (rows.length !== baseline.length) return true;
  const was = new Map(baseline.map((r) => [r.studentId, r]));
  return rows.some((r) => {
    const b = was.get(r.studentId);
    return !b || b.marks !== r.marks || b.isAbsent !== r.isAbsent || b.remarks !== r.remarks;
  });
}

// Every row is sent, blank ones as null, which is what the web does.
export function buildMarksPayload(examSubjectId: number, rows: MarkRow[]) {
  return {
    exam_subject_id: examSubjectId,
    marks: rows.map((r) => ({
      student_id: r.studentId,
      marks_obtained: r.isAbsent || r.marks.trim() === '' ? null : parseFloat(r.marks),
      is_absent: r.isAbsent,
      remarks: r.remarks,
    })),
  };
}

// The server answers 200 even when it skips rows it rejects; turn those into readable lines.
export function describeRejected(errors: Array<{ student_id?: number; error?: string }> | undefined, rows: MarkRow[]): string[] {
  const names = new Map(rows.map((r) => [r.studentId, r.name]));
  return (errors || []).map((e) => `${names.get(e.student_id as number) ?? 'Student'}: ${e.error ?? 'not saved'}`);
}

// A single-subject exam preselects its subject; otherwise try the subject named in the exam title.
export function inferSubjectId(examName: string | undefined, subjects: ExamSubjectLite[]): number | null {
  if (subjects.length === 1) return subjects[0].id;
  const name = String(examName || '').toLowerCase();
  if (!name) return null;
  const match = subjects.find((s) => name.includes(String(s.subject_name || '').toLowerCase()));
  return match ? match.id : null;
}

// Students of the exam's own section; a class-wide exam covers the whole master class.
export function rosterParams(exam: ExamLite): Record<string, unknown> {
  return {
    ...(exam.session_class ? { session_class_id: exam.session_class } : { class_id: exam.class_obj }),
    academic_year: exam.academic_year,
    is_active: true,
    page_size: 9999,
  };
}

// When a section is picked, hide exams that belong to another section of the same class.
export function examsForSection(exams: ExamLite[], sectionId: number | null, isSession: boolean): ExamLite[] {
  if (!isSession || sectionId == null) return exams;
  return exams.filter((e) => !e.session_class || e.session_class === sectionId);
}
