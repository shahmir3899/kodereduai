// Pure logic for lesson plans; port of frontend/src/pages/lms/LessonPlansPage.jsx and the rules in
// backend/lms/serializers.py (LessonPlanCreateSerializer). Admin, principal and teacher write
// (CanEditCurriculum); AI drafting, bulk creation and curriculum topic picking stay on the web.

import type { ClassOption } from './attendanceEntry';

export interface LessonPlan {
  id: number;
  title: string;
  description?: string;
  objectives?: string;
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
  planned_topics?: Array<number | { id: number }>;
}

export interface LessonPlanForm {
  title: string;
  classOption: number | null;
  subject: number | null;
  teacher: number | null;
  date: string;
  duration: string;
  objectives: string;
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
  title: '', classOption: null, subject: null, teacher, date: today, duration: '40', objectives: '', description: '',
  materials: '', methods: '', topics: '', published: false, topicIds: [], aiJobId: null,
});

export const planToForm = (p: LessonPlan, options: ClassOption[]): LessonPlanForm => ({
  title: p.title,
  // A plan on a section maps back to that section; an old whole-class plan to the master class.
  classOption: (p.session_class ? options.find((o) => o.isSession && o.id === p.session_class) : options.find((o) => !o.isSession && o.id === p.class_obj))?.id ?? p.session_class ?? p.class_obj,
  subject: p.subject, teacher: p.teacher, date: p.lesson_date, duration: String(p.duration_minutes),
  objectives: p.objectives ?? '', description: p.description ?? '', materials: p.materials_needed ?? '', methods: p.teaching_methods ?? '',
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
    objectives: f.objectives.trim(),
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
