import type { ModuleKey } from '../constants/modules';
import type { TimetableEntry } from './teacher';

// Pure helpers for the teacher dashboard; port of frontend/src/pages/teacher/teacherDashboardUtils.js.

export interface Assignment {
  id: number;
  class_obj: number;
  session_class?: number | null;
  class_name?: string;
  class_section?: string;
}

const toMinutes = (t?: string | null): number | null => {
  if (!t) return null;
  const [h, m] = String(t).slice(0, 5).split(':').map(Number);
  return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
};

export interface PeriodState {
  index: number;
  state: 'now' | 'next' | null;
  minutes: number;
}

// Where "now" sits in today's timetable (entries ordered by slot). Slots with no start/end time
// are skipped rather than treated as 00:00.
export function findPeriod(timetable: TimetableEntry[], now: Date): PeriodState {
  const cur = now.getHours() * 60 + now.getMinutes();
  for (let i = 0; i < timetable.length; i++) {
    const start = toMinutes(timetable[i].slot_start_time);
    const end = toMinutes(timetable[i].slot_end_time);
    if (start != null && end != null && cur >= start && cur < end) return { index: i, state: 'now', minutes: end - cur };
  }
  for (let i = 0; i < timetable.length; i++) {
    const start = toMinutes(timetable[i].slot_start_time);
    if (start != null && cur < start) return { index: i, state: 'next', minutes: start - cur };
  }
  return { index: -1, state: null, minutes: 0 };
}

// Which class-teacher assignment covers a timetable entry. An entry with a session class only
// matches that exact section; a shared entry matches on the master class.
export function matchAssignment(entry: TimetableEntry | null | undefined, assignments: Assignment[]): Assignment | null {
  if (!entry) return null;
  return (
    assignments.find((a) =>
      entry.session_class ? Number(a.session_class) === Number(entry.session_class) : Number(a.class_obj) === Number(entry.class_obj),
    ) || null
  );
}

// Lookup params that stay inside ONE section. The master class is only used for legacy
// assignments with no session class: using it for a sectioned class would mix its sections.
export function sectionParams(a: Assignment, academicYearId: number | null): Record<string, unknown> {
  const ay = academicYearId ? { academic_year: academicYearId } : {};
  return a.session_class ? { session_class_id: a.session_class, ...ay } : { class_id: a.class_obj, ...ay };
}

// The id the attendance screen selects: the session class when there is one.
export function attendanceClassId(a: Assignment): number {
  return a.session_class || a.class_obj;
}

export function assignmentLabel(a: Assignment): string {
  return `${a.class_name ?? 'Class'}${a.class_section ? ` - ${a.class_section}` : ''}`;
}

// Total from a paginated list (works with page_size=1) or a plain array.
export function countOf(data: unknown): number | null {
  if (data == null) return null;
  const d = data as { count?: unknown; results?: unknown };
  if (typeof d.count === 'number') return d.count;
  const list = d.results ?? data;
  return Array.isArray(list) ? list.length : null;
}

export interface SectionProgress {
  assignment: Assignment;
  total: number | null;
  marked: number | null;
  failed: boolean;
}

// A section still needs attendance when it has students and fewer records than students.
export function isPending(row: SectionProgress): boolean {
  return !row.failed && (row.total || 0) > 0 && (row.marked || 0) < (row.total as number);
}

export interface ExamLite { id: number; name: string; status: string; class_name?: string; start_date?: string | null }

export function upcomingExams(exams: ExamLite[], limit = 5): ExamLite[] {
  return exams.filter((e) => e.status === 'SCHEDULED' || e.status === 'PUBLISHED').slice(0, limit);
}

// Published exams are the ones open for marks entry.
export function examsAwaitingMarks(exams: ExamLite[]): number {
  return exams.filter((e) => e.status === 'PUBLISHED').length;
}

export function studentsAtRiskCount(risk?: { attendance?: { at_risk_count?: number }; academic?: { at_risk_count?: number } } | null): number {
  return (risk?.attendance?.at_risk_count || 0) + (risk?.academic?.at_risk_count || 0);
}

export type Tone = 'red' | 'amber';
export interface AttentionItem { key: string; count: number; label: string; tone: Tone; href?: string }

export function buildTeacherAttention(input: {
  isModuleEnabled: (key: ModuleKey) => boolean;
  isOffDay: boolean;
  pendingAttendanceClasses: number;
  submissionsToGrade: number | null;
  examsAwaitingMarks: number;
  studentsAtRisk: number;
  routes: Partial<Record<'attendance' | 'marks' | 'assignments', string>>;
}): AttentionItem[] {
  const { isModuleEnabled: on } = input;
  const items: AttentionItem[] = [];
  const add = (key: string, count: unknown, label: string, tone: Tone, href?: string) => {
    if (Number(count) > 0) items.push({ key, count: Number(count), label, tone, href });
  };
  if (on('attendance') && !input.isOffDay) {
    add('att', input.pendingAttendanceClasses, 'classes still need attendance', 'red', input.routes.attendance);
  }
  if (on('examinations')) add('marks', input.examsAwaitingMarks, 'exams awaiting marks entry', 'amber', input.routes.marks);
  if (on('academics')) add('grade', input.submissionsToGrade, 'submissions to grade', 'amber', input.routes.assignments);
  add('risk', input.studentsAtRisk, 'students at risk in your classes', 'amber');
  return items;
}

export function minutesLabel(minutes: number): string {
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`;
}
