// Shapes and helpers for the leadership insights on the admin home; port of the web's
// LeadershipInsightsPanels.jsx (bootstrap leadership-academic-insights).

export interface CountBlock { count?: number }
export interface DepartureBlock { total?: number; by_status?: Record<string, number> }
export interface LessonPlanRow {
  teacher_id: number; class_id: number; teacher_name: string; class_name: string;
  previous_month: number; current_month: number; next_month: number;
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

export function hasCurriculumData(data: LeadershipData | null | undefined): boolean {
  return (data?.lms_books_by_class?.length ?? 0) > 0 || (data?.question_bank?.total ?? 0) > 0
    || (data?.lesson_plans?.by_teacher_class?.length ?? 0) > 0;
}
