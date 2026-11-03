// Curriculum Coverage: which topics of a class and subject have been taught and tested, with a
// planned date per topic. Port of the web's CurriculumCoveragePage. Pure logic, no React imports.

export interface CoverageTopic {
  id: number;
  topic_number?: number | string | null;
  title: string;
  is_covered?: boolean;
  is_tested?: boolean;
  planned_date?: string | null;
  taught_date?: string | null;
  lesson_plan_count?: number;
  test_question_count?: number;
  // Planned-vs-taught, computed by the server for the academic year in the query; null without one.
  coverage_status?: ScheduleStatus | null;
  coverage_days?: number;
}

export type ScheduleStatus = 'not_planned' | 'upcoming' | 'overdue' | 'on_time' | 'late' | 'unscheduled';
export type ScheduleFilter = '' | ScheduleStatus;

export const SCHEDULE_FILTERS: Array<{ value: ScheduleFilter; label: string }> = [
  { value: '', label: 'All schedules' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'late', label: 'Taught late' },
  { value: 'on_time', label: 'Taught on time' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'not_planned', label: 'Not planned' },
  { value: 'unscheduled', label: 'Taught, no plan date' },
];

const SCHEDULE_LABELS: Record<ScheduleStatus, { label: string; tone: 'success' | 'warning' | 'error' | 'info' | 'neutral' }> = {
  not_planned: { label: 'Not planned', tone: 'neutral' },
  upcoming: { label: 'Upcoming', tone: 'info' },
  overdue: { label: 'Overdue', tone: 'error' },
  on_time: { label: 'On time', tone: 'success' },
  late: { label: 'Late', tone: 'warning' },
  unscheduled: { label: 'Taught (no plan date)', tone: 'neutral' },
};

// Null when the server sent no status (no academic year in scope). Late and overdue carry the day count.
export function scheduleStatus(t: Pick<CoverageTopic, 'coverage_status' | 'coverage_days'>): { label: string; tone: 'success' | 'warning' | 'error' | 'info' | 'neutral' } | null {
  const s = t.coverage_status ? SCHEDULE_LABELS[t.coverage_status] : null;
  if (!s) return null;
  const days = t.coverage_days ?? 0;
  return (t.coverage_status === 'late' || t.coverage_status === 'overdue') && days > 0 ? { ...s, label: `${s.label} · ${days}d` } : s;
}

export type CoverageFilter = '' | 'taught_only' | 'tested_only' | 'both' | 'uncovered';

export const COVERAGE_FILTERS: Array<{ value: CoverageFilter; label: string }> = [
  { value: '', label: 'All topics' },
  { value: 'taught_only', label: 'Taught only' },
  { value: 'tested_only', label: 'Tested only' },
  { value: 'both', label: 'Taught & tested' },
  { value: 'uncovered', label: 'Uncovered' },
];

export type CoverageTone = 'success' | 'warning' | 'info' | 'neutral';

export function topicStatus(t: Pick<CoverageTopic, 'is_covered' | 'is_tested'>): { label: string; tone: CoverageTone } {
  if (t.is_covered && t.is_tested) return { label: 'Taught & tested', tone: 'success' };
  if (t.is_covered) return { label: 'Taught only', tone: 'warning' };
  if (t.is_tested) return { label: 'Tested only', tone: 'info' };
  return { label: 'Not covered', tone: 'neutral' };
}

export function coverageStats(topics: CoverageTopic[]) {
  return {
    total: topics.length,
    taught: topics.filter((t) => t.is_covered).length,
    tested: topics.filter((t) => t.is_tested).length,
    late: topics.filter((t) => t.coverage_status === 'late').length,
    overdue: topics.filter((t) => t.coverage_status === 'overdue').length,
  };
}

export const topicName = (t: CoverageTopic) => (t.topic_number != null && t.topic_number !== '' ? `${t.topic_number}. ${t.title}` : t.title);

// The list query: class and subject are required, the filter and year are optional.
export function topicParams(input: { masterClassId: number; subjectId: number; coverage: CoverageFilter; schedule?: ScheduleFilter; academicYearId?: number | null }) {
  return {
    page_size: 999,
    class_id: input.masterClassId,
    subject_id: input.subjectId,
    ...(input.coverage ? { coverage: input.coverage } : {}),
    // The server only evaluates schedule status within an academic year.
    ...(input.schedule && input.academicYearId ? { coverage_status: input.schedule } : {}),
    ...(input.academicYearId ? { academic_year: input.academicYearId } : {}),
  };
}

// Same body as the web: an empty date clears the planned date.
export function plannedDateBody(academicYearId: number, plannedDate: string | null) {
  return { academic_year: academicYearId, planned_date: plannedDate || null };
}
