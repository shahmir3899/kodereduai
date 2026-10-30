// Pure helpers for the Results and Exam Schedule screens; port of
// frontend/src/pages/examinations/ResultsPage.jsx and pages/academics/TeacherExamSchedule.jsx.

export interface ResultMark {
  subject_id?: number;
  subject_name: string;
  total_marks?: number;
  marks_obtained: number | null;
  is_absent?: boolean;
  ai_comment?: string | null;
  comment_source?: 'AI' | 'FALLBACK' | 'EDITED' | null;
}
export interface ResultRow {
  student_id: number;
  student_name: string;
  roll_number?: string | null;
  rank?: number | null;
  total_obtained?: number | null;
  total_possible?: number | null;
  percentage?: number | null;
  grade?: string | null;
  is_pass?: boolean;
  marks?: ResultMark[];
  overall_comment?: string | null;
  overall_comment_source?: 'AI' | 'FALLBACK' | 'EDITED' | null;
}

export type ResultStatus = 'pass' | 'fail' | 'incomplete';

// The server's is_pass needs every subject passed, so a student with a subject not yet entered
// is "incomplete", not failed.
export function resultStatus(r: ResultRow): ResultStatus {
  if (r.marks?.some((m) => m.marks_obtained == null && !m.is_absent)) return 'incomplete';
  return r.is_pass ? 'pass' : 'fail';
}

export interface ResultsSummary {
  total: number;
  pass: number;
  fail: number;
  incomplete: number;
  average: number | null;
  toppers: string[];
  topperTotal: number | null | undefined;
  topperPercent: number | null | undefined;
}

export function summarizeResults(rows: ResultRow[]): ResultsSummary | null {
  if (rows.length === 0) return null;
  const complete = rows.filter((r) => resultStatus(r) !== 'incomplete');
  const withMarks = rows.filter((r) => (r.total_obtained ?? 0) > 0);
  const toppers = rows.filter((r) => r.rank === 1);
  return {
    total: rows.length,
    pass: complete.filter((r) => resultStatus(r) === 'pass').length,
    fail: complete.filter((r) => resultStatus(r) === 'fail').length,
    incomplete: rows.length - complete.length,
    average: withMarks.length ? withMarks.reduce((s, r) => s + Number(r.percentage ?? 0), 0) / withMarks.length : null,
    toppers: toppers.map((t) => t.student_name),
    topperTotal: toppers[0]?.total_obtained,
    topperPercent: toppers[0]?.percentage,
  };
}

export function formatPercent(value: number | string | null | undefined): string {
  return value == null || value === '' || Number.isNaN(Number(value)) ? '—' : `${Number(value).toFixed(1)}%`;
}

export interface ScheduleSubject { id: number; exam: number; subject_name: string; subject_code?: string | null; exam_date?: string | null }

// Subjects grouped by exam, each group in date order. Undated subjects go last.
export function groupSubjectsByExam(subjects: ScheduleSubject[]): Record<number, ScheduleSubject[]> {
  const map: Record<number, ScheduleSubject[]> = {};
  for (const s of subjects) (map[s.exam] ||= []).push(s);
  for (const list of Object.values(map)) {
    list.sort((a, b) => {
      if (!a.exam_date !== !b.exam_date) return a.exam_date ? -1 : 1;
      return (a.exam_date || '').localeCompare(b.exam_date || '');
    });
  }
  return map;
}
