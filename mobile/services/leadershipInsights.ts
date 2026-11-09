// Shapes and helpers for the leadership insights on the admin home; port of the web's
// LeadershipInsightsPanels.jsx (bootstrap leadership-academic-insights).

export interface CountBlock { count?: number }
export interface DepartureBlock { total?: number; by_status?: Record<string, number> }
export interface LessonPlanRow {
  teacher_id: number; class_id: number; teacher_name: string; class_name: string;
  previous_month: number; current_month: number; next_month: number;
}
export type PlanMonth = 'previous_month' | 'current_month' | 'next_month';
export interface LessonPlanSubjectCount {
  subject_id: number; subject_name: string; previous_month: number; current_month: number; next_month: number; draft_current_month: number;
}
export interface LessonPlanTeacherRow {
  teacher_id: number; teacher_name: string; previous_month: number; current_month: number; next_month: number; draft_current_month: number;
  subjects: LessonPlanSubjectCount[];
}
export interface LessonPlanClassRow {
  class_id: number; class_name: string; previous_month: number; current_month: number; next_month: number; teachers: LessonPlanTeacherRow[];
}
export interface LeadershipData {
  admissions?: { session?: CountBlock | null; rolling_30d?: CountBlock; rolling_90d?: CountBlock };
  departures?: { session?: DepartureBlock | null; rolling_30d?: DepartureBlock; rolling_90d?: DepartureBlock };
  lms_books_by_class?: Array<{ class_id: number; class_name: string; book_count: number }>;
  lms_topics_by_book?: Array<{ book_id: number; book_title: string; class_name?: string; topic_count: number }>;
  question_bank?: { total?: number; by_subject?: Array<{ subject_id: number; subject_name: string; count: number }> };
  lesson_plans?: {
    buckets?: { previous_month?: { label?: string }; current_month?: { label?: string }; next_month?: { label?: string } };
    by_teacher_class?: LessonPlanRow[];
    by_class?: LessonPlanClassRow[];
  };
}

// Same gates as the web: the roster block needs students or admissions, the curriculum block lms or examinations.
export function insightGates(on: (key: 'students' | 'admissions' | 'lms' | 'examinations') => boolean) {
  return { roster: on('students') || on('admissions'), curriculum: on('lms') || on('examinations') };
}

// "withdrawn 2 · transferred 1": non-zero statuses only, underscores as spaces.
export function departureLine(block: DepartureBlock | null | undefined): string {
  const parts = Object.entries(block?.by_status ?? {}).filter(([, n]) => n > 0).map(([k, n]) => `${k.replace(/_/g, ' ').toLowerCase()} ${n}`);
  return parts.join(' · ');
}

export const LESSON_PLAN_PREVIEW = 8;

export function lessonPlanPreview(data: LeadershipData | null | undefined, limit = LESSON_PLAN_PREVIEW) {
  const rows = data?.lesson_plans?.by_teacher_class ?? [];
  return { rows: rows.slice(0, limit), total: rows.length };
}

// Classes worth showing for a month: those with plans in it, plus any class where a teacher has a subject
// with plans in another month but none in this one (a gap the leader should see, shown as 0).
export function lessonPlanClassRows(data: LeadershipData | null | undefined, month: PlanMonth): LessonPlanClassRow[] {
  return (data?.lesson_plans?.by_class ?? []).filter(
    (c) => c[month] > 0 || c.teachers.some((t) => t.subjects.some((s) => s[month] === 0)),
  );
}

export interface BehindTeacher { teacher_id: number; teacher_name: string; current: number; previous: number; drafts: number }

// Teachers whose plan count this month is below last month's, or who still have drafts waiting. A teacher
// teaches in several classes, so their rows are added up across the class tree. Biggest drop first.
export function teachersBehind(data: LeadershipData | null | undefined, limit = 5): BehindTeacher[] {
  const byTeacher = new Map<number, BehindTeacher>();
  for (const c of data?.lesson_plans?.by_class ?? []) {
    for (const t of c.teachers) {
      const row = byTeacher.get(t.teacher_id) ?? { teacher_id: t.teacher_id, teacher_name: t.teacher_name, current: 0, previous: 0, drafts: 0 };
      row.current += t.current_month;
      row.previous += t.previous_month;
      row.drafts += t.draft_current_month;
      byTeacher.set(t.teacher_id, row);
    }
  }
  return [...byTeacher.values()]
    .filter((r) => r.current < r.previous || r.drafts > 0)
    .sort((a, b) => (b.previous - b.current) - (a.previous - a.current) || b.drafts - a.drafts || a.teacher_name.localeCompare(b.teacher_name))
    .slice(0, limit);
}

export function hasCurriculumData(data: LeadershipData | null | undefined): boolean {
  return (data?.lms_books_by_class?.length ?? 0) > 0 || (data?.question_bank?.total ?? 0) > 0
    || (data?.lesson_plans?.by_teacher_class?.length ?? 0) > 0 || (data?.lesson_plans?.by_class?.length ?? 0) > 0;
}
