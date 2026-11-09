// Pure logic for lesson plans; port of frontend/src/pages/lms/LessonPlansPage.jsx and the rules in
// backend/lms/serializers.py (LessonPlanCreateSerializer). Admin, principal and teacher write
// (CanEditCurriculum); AI drafting, bulk creation and curriculum topic picking stay on the web.

import type { ClassOption } from './attendanceEntry';
import { newRow, rowsFromPlan, rowsToText, type LinkedObjective, type ObjectiveRow } from './lessonPlanObjectives';

export interface LessonPlan {
  id: number;
  title: string;
  description?: string;
  objectives?: string;
  objectives_text?: string;
  // Curriculum objectives attached to the plan, with their Bloom level.
  linked_objectives?: LinkedObjective[];
  lesson_date: string;
  duration_minutes: number;
  materials_needed?: string;
  teaching_methods?: string;
  status: 'DRAFT' | 'PUBLISHED' | string;
  class_obj: number;
  session_class?: number | null;
  class_name?: string;
  subject: number;
  subject_name?: string;
  teacher: number;
  teacher_name?: string;
  custom_topics?: string[];
  display_text?: string;
  ai_generated?: boolean;
  planned_topics?: Array<number | { id: number; title?: string; name?: string }>;
}

export interface LessonPlanForm {
  title: string;
  classOption: number | null;
  subject: number | null;
  teacher: number | null;
  date: string;
  duration: string;
  objectives: string;
  // What the screen edits; `objectives` is the plain text it is saved as (and what an AI draft fills).
  objectiveRows: ObjectiveRow[];
  description: string;
  materials: string;
  methods: string;
  topics: string;
  published: boolean;
  // Topics picked from the curriculum books, and the AI draft they came with (if any).
  topicIds: number[];
  aiJobId: number | null;
}

export const emptyPlanForm = (today: string, teacher: number | null = null): LessonPlanForm => ({
  title: '', classOption: null, subject: null, teacher, date: today, duration: '40', objectives: '', objectiveRows: [newRow()], description: '',
  materials: '', methods: '', topics: '', published: false, topicIds: [], aiJobId: null,
});

// A plan on a section maps back to that section; an old whole-class plan to the master class, or, when the
// school now lists sections only, to the class's first section (as the web does). A class that is not
// in the list (a teacher no longer teaching it) gives null, so the person must choose it rather than
// the form sending an id the server would refuse.
export function classOptionFor(p: Pick<LessonPlan, 'session_class' | 'class_obj'>, options: ClassOption[]): number | null {
  const exact = p.session_class ? options.find((o) => o.isSession && o.id === p.session_class) : options.find((o) => !o.isSession && o.id === p.class_obj);
  if (exact) return exact.id;
  if (!p.session_class) return options.find((o) => o.isSession && o.classObj === p.class_obj)?.id ?? null;
  return null;
}

export const planToForm = (p: LessonPlan, options: ClassOption[]): LessonPlanForm => ({
  title: p.title,
  // A plan on a section maps back to that section; an old whole-class plan to the master class.
  classOption: classOptionFor(p, options),
  subject: p.subject, teacher: p.teacher, date: p.lesson_date, duration: String(p.duration_minutes),
  objectives: p.objectives ?? '', objectiveRows: rowsFromPlan(p), description: p.description ?? '', materials: p.materials_needed ?? '', methods: p.teaching_methods ?? '',
  topics: (p.custom_topics ?? []).join('\n'), published: p.status === 'PUBLISHED',
  topicIds: (p.planned_topics ?? []).map((t) => (typeof t === 'number' ? t : t.id)), aiJobId: null,
});

// One topic per line, at most 20 (the server limit), blank lines dropped.
export const topicsFromText = (text: string): string[] => text.split('\n').map((t) => t.trim()).filter(Boolean).slice(0, 20);

export function validatePlan(f: LessonPlanForm): string | null {
  if (!f.title.trim()) return 'Enter the lesson title.';
  if (f.title.trim().length > 200) return 'The title is too long (200 letters at most).';
  if (!f.classOption) return 'Choose the class.';
  if (!f.subject) return 'Choose the subject.';
  if (!f.teacher) return 'Choose the teacher.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return 'Choose the lesson date.';
  if (!/^\d+$/.test(f.duration.trim()) || Number(f.duration) < 1 || Number(f.duration) > 600) return 'Duration must be 1 to 600 minutes.';
  if (f.topics.split('\n').filter((t) => t.trim()).length > 20) return 'At most 20 topics.';
  return null;
}

// class_obj is always the master class; session_class is set only for a section, and the server
// refuses a section that does not belong to the class.
export function buildPlanPayload(f: LessonPlanForm, option: ClassOption | undefined, ids: { school: number; academicYear?: number | null }) {
  const isSection = !!option?.isSession;
  return {
    school: ids.school,
    ...(ids.academicYear ? { academic_year: ids.academicYear } : {}),
    class_obj: isSection ? option!.classObj : option?.id,
    session_class: isSection ? option!.id : null,
    subject: f.subject,
    teacher: f.teacher,
    title: f.title.trim(),
    description: f.description.trim(),
    // The rows are what the person edited; the old text stays only when there are no rows (an AI draft not yet split).
    objectives: rowsToText(f.objectiveRows) || f.objectives.trim(),
    lesson_date: f.date,
    duration_minutes: Number(f.duration),
    materials_needed: f.materials.trim(),
    teaching_methods: f.methods.trim(),
    custom_topics: topicsFromText(f.topics),
    planned_topic_ids: f.topicIds,
    content_mode: f.topicIds.length > 0 ? 'TOPICS' : 'FREEFORM',
    ...(f.aiJobId ? { ai_generated: true, ai_job_id: f.aiJobId } : {}),
    status: f.published ? 'PUBLISHED' : 'DRAFT',
    is_active: true,
  };
}

export const statusTone = (s: string): 'success' | 'neutral' => (s === 'PUBLISHED' ? 'success' : 'neutral');

// Newest lesson date first.
export const sortPlans = (list: LessonPlan[]): LessonPlan[] =>
  [...list].sort((a, b) => b.lesson_date.localeCompare(a.lesson_date) || b.id - a.id);

// ── Finding and acting on many plans ──────────────────────────────────────────

export interface PlanFilters { classOption: number | null; subject: number | null; from: string; to: string; teacher?: number | null }
export const emptyFilters = (): PlanFilters => ({ classOption: null, subject: null, from: '', to: '' });

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// Either end of the date range may be left open; when both are set, From must not be after To.
export function filterProblem(f: PlanFilters): string | null {
  if (f.from && !ISO_DAY.test(f.from)) return 'Choose a valid From date.';
  if (f.to && !ISO_DAY.test(f.to)) return 'Choose a valid To date.';
  if (f.from && f.to && f.from > f.to) return 'From must not be after To.';
  return null;
}

// How many of the four filters are in use, for the badge on the Filters button.
export function activeFilterCount(f: PlanFilters): number {
  return [f.classOption, f.subject, f.from, f.to, f.teacher ?? null].filter((v) => v !== null && v !== '').length;
}

// Query params for the list call. A section sends its master class and its own id, as the web does,
// so another section of the same class is not mixed in. An invalid date range sends no dates.
export function filterParams(f: PlanFilters, options: ClassOption[]): Record<string, number | string> {
  const params: Record<string, number | string> = {};
  const option = f.classOption != null ? options.find((o) => o.id === f.classOption) : undefined;
  if (option) {
    if (option.isSession) {
      if (option.classObj) params.class_id = option.classObj;
      params.session_class_id = option.id;
    } else {
      params.class_id = option.id;
    }
  }
  if (f.subject != null) params.subject_id = f.subject;
  if (f.teacher != null) params.teacher_id = f.teacher;
  if (!filterProblem(f)) {
    if (f.from) params.date_from = f.from;
    if (f.to) params.date_to = f.to;
  }
  return params;
}

// Only drafts can be published; the server skips the rest, so they are left out of the request.
export const canPublish = (p: Pick<LessonPlan, 'status'>) => p.status === 'DRAFT';
export const draftIdsOf = (rows: Array<Pick<LessonPlan, 'id' | 'status'>>, selected: number[]): number[] =>
  rows.filter((r) => selected.includes(r.id) && canPublish(r)).map((r) => r.id);

const plans = (n: number) => `${n} lesson plan${n === 1 ? '' : 's'}`;

export const bulkDeleteText = (n: number) => `${plans(n)} will be deleted for good. This cannot be undone.`;
export const bulkPublishText = (n: number) => `${plans(n)} will be published and students will be told.`;

export function bulkDeleteResultText(data: unknown): string {
  const d = data as { requested_count?: number; deleted_count?: number } | null;
  const done = d?.deleted_count ?? 0;
  const left = (d?.requested_count ?? done) - done;
  return left > 0 ? `${plans(done)} deleted. ${left} could not be deleted.` : `${plans(done)} deleted.`;
}

export function bulkPublishResultText(data: unknown): string {
  const d = data as { requested_count?: number; published_count?: number } | null;
  const done = d?.published_count ?? 0;
  const left = (d?.requested_count ?? done) - done;
  return left > 0 ? `${plans(done)} published. ${left} skipped (already published or not yours).` : `${plans(done)} published.`;
}

// ── Quick plan ────────────────────────────────────────────────────────────────
// The web's "Minimal" mode: only the class, subject, date and what is taught. The title is made from
// the topics, and the plan is a draft of 45 minutes to be filled in later.

export const QUICK_DURATION = '45';

// "Fractions, Decimals" from the picked topics, then any topics typed by hand; at most three of each.
export function autoTitle(pickedTopicNames: string[], customTopics: string[], fallback = 'Lesson'): string {
  const unique = [...new Set(pickedTopicNames.map((n) => n.trim()).filter(Boolean))].slice(0, 3);
  const custom = customTopics.map((t) => t.trim()).filter(Boolean).slice(0, 3);
  const joined = [unique.join(', '), custom.join(', ')].filter(Boolean).join('\n');
  return (joined || fallback).slice(0, 200);
}

// The class's subject row that names the teacher for `subject`, if it has one.
export function teacherFromAssignments(rows: Array<{ subject: number; teacher?: number | null; is_active?: boolean }>, subject: number | null): number | null {
  if (subject == null) return null;
  const match = rows.find((r) => r.subject === subject && r.is_active !== false && r.teacher != null);
  return match?.teacher ?? null;
}

export function validateQuick(f: LessonPlanForm): string | null {
  if (!f.classOption) return 'Choose the class.';
  if (!f.subject) return 'Choose the subject.';
  if (!f.teacher) return 'No teacher is set for this class and subject. Choose one.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return 'Choose the lesson date.';
  if (f.topicIds.length === 0 && topicsFromText(f.topics).length === 0) return 'Pick a topic from the book or type one.';
  return null;
}

// A quick plan fills the form's other fields with nothing, so the shared payload builder can be used.
export function quickForm(f: LessonPlanForm, pickedTopicNames: string[]): LessonPlanForm {
  return {
    ...f,
    title: autoTitle(pickedTopicNames, topicsFromText(f.topics)),
    duration: QUICK_DURATION,
    objectives: '', objectiveRows: [newRow()], description: '', materials: '', methods: '',
    published: false, aiJobId: null,
  };
}
