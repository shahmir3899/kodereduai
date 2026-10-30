// Pure logic for the lesson plan extras: picking curriculum topics, the AI draft and creating a run
// of plans over a date range; port of LessonPlanTopicsPickerModal, LessonPlanAIModal and
// BulkLessonPlansModal (frontend/src/pages/lms) and the rules in backend/lms (bulk_create,
// generate_lesson_plan_ai).

import type { LessonPlanForm } from './lessonPlans';

export interface TopicChoice { id: number; title: string; topic_number?: number | null; content_kind?: string }
export interface ChapterChoice { id: number; title: string; chapter_number?: number | null; topics: TopicChoice[] }
export interface BookChoice { id: number; title: string; chapters: ChapterChoice[] }

// Books answer { id, title, chapters: [{ id, title, topics: [...] }] } for a class and subject;
// anything without topics is dropped, chapters ordered by number.
export function booksOf(data: unknown): BookChoice[] {
  const list = Array.isArray(data) ? data : ((data as { results?: unknown[] } | undefined)?.results ?? []);
  return (list as Array<Record<string, unknown>>).map((b) => ({
    id: Number(b.id),
    title: String(b.title ?? 'Book'),
    chapters: ((b.chapters as Array<Record<string, unknown>> | undefined) ?? [])
      .map((c) => ({
        id: Number(c.id),
        title: String(c.title ?? ''),
        chapter_number: c.chapter_number != null ? Number(c.chapter_number) : null,
        topics: ((c.topics as Array<Record<string, unknown>> | undefined) ?? []).map((t) => ({
          id: Number(t.id), title: String(t.title ?? ''), topic_number: t.topic_number != null ? Number(t.topic_number) : null, content_kind: t.content_kind as string | undefined,
        })),
      }))
      .filter((c) => c.topics.length > 0)
      .sort((a, b) => (a.chapter_number ?? 0) - (b.chapter_number ?? 0)),
  })).filter((b) => b.chapters.length > 0);
}

export const toggleId = (ids: number[], id: number): number[] => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

// Tick or untick every topic of a chapter at once.
export function toggleChapter(ids: number[], chapter: ChapterChoice): number[] {
  const all = chapter.topics.map((t) => t.id);
  return all.every((id) => ids.includes(id)) ? ids.filter((id) => !all.includes(id)) : Array.from(new Set([...ids, ...all]));
}

// "Chapter 2: Fractions - Adding, Subtracting" for the chosen topics, to show under the picker.
export function topicSummary(books: BookChoice[], ids: number[]): string {
  const parts: string[] = [];
  for (const b of books) {
    for (const c of b.chapters) {
      const names = c.topics.filter((t) => ids.includes(t.id)).map((t) => t.title);
      if (names.length > 0) parts.push(`${c.chapter_number != null ? `Chapter ${c.chapter_number}: ` : ''}${c.title} - ${names.join(', ')}`);
    }
  }
  return parts.join('\n');
}

export function chapterIdsFor(books: BookChoice[], topicIds: number[]): number[] {
  return books.flatMap((b) => b.chapters).filter((c) => c.topics.some((t) => topicIds.includes(t.id))).map((c) => c.id);
}

// ─── AI draft ──────────────────────────────────────────────────────────────────────────────

export function validateAiDraft(f: Pick<LessonPlanForm, 'topicIds' | 'date'>): string | null {
  if (f.topicIds.length === 0) return 'Pick at least one topic for the draft to be about.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return 'Choose the lesson date first.';
  return null;
}

export function aiRequest(f: Pick<LessonPlanForm, 'topicIds' | 'date' | 'duration'>, books: BookChoice[]) {
  return {
    topic_ids: f.topicIds,
    chapter_ids: chapterIdsFor(books, f.topicIds),
    subtopic_ids: [] as number[],
    lesson_date: f.date,
    duration_minutes: Number(f.duration) || 45,
  };
}

export interface AiResult { success?: boolean; error?: string; title?: string; objectives?: string; description?: string; teaching_methods?: string; materials_needed?: string; ai_job_id?: number }

// Fills only what the draft gave; the person's own title stays if the draft has none.
export function applyAiDraft(f: LessonPlanForm, r: AiResult): LessonPlanForm {
  return {
    ...f,
    title: r.title?.trim() || f.title,
    objectives: r.objectives ?? f.objectives,
    description: r.description ?? f.description,
    methods: r.teaching_methods ?? f.methods,
    materials: r.materials_needed ?? f.materials,
    aiJobId: r.ai_job_id ?? null,
  };
}

export const aiProblem = (r: AiResult): string | null => (r.success === false ? r.error ?? 'The draft could not be made.' : null);

// ─── Bulk run ──────────────────────────────────────────────────────────────────────────────

export const BULK_MAX_DAYS = 35;

export interface BulkPlanForm { from: string; to: string; skipSaturday: boolean; onConflict: 'skip' | 'error'; titleTemplate: string }

export const emptyBulkPlanForm = (today: string): BulkPlanForm => ({ from: today, to: today, skipSaturday: true, onConflict: 'skip', titleTemplate: '' });

const day = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd); };
export const rangeDays = (from: string, to: string) => Math.round((day(to) - day(from)) / 86400000) + 1;

export function validateBulkPlans(f: BulkPlanForm): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.from) || !/^\d{4}-\d{2}-\d{2}$/.test(f.to)) return 'Choose the first and last day.';
  if (f.to < f.from) return 'The last day is before the first day.';
  if (rangeDays(f.from, f.to) > BULK_MAX_DAYS) return `Choose at most ${BULK_MAX_DAYS} days at a time.`;
  return null;
}

// The single-plan payload plus the range; teaching days are worked out by the server (school off
// days and Sundays are skipped there).
export function buildBulkPlanPayload(single: Record<string, unknown>, f: BulkPlanForm) {
  const keep = ['school', 'academic_year', 'class_obj', 'session_class', 'subject', 'teacher', 'duration_minutes', 'description', 'objectives', 'materials_needed', 'teaching_methods', 'custom_topics', 'planned_topic_ids', 'content_mode'];
  const out: Record<string, unknown> = {};
  for (const k of keep) if (single[k] !== undefined) out[k] = single[k];
  return { ...out, date_from: f.from, date_to: f.to, skip_saturday: f.skipSaturday, on_conflict: f.onConflict, title_template: f.titleTemplate.trim() };
}

export function bulkResultText(r: { created_count?: number; created?: number; skipped_dates?: string[]; skipped_off_days?: unknown[]; ids?: number[] } | undefined): string {
  const made = r?.created_count ?? r?.created ?? r?.ids?.length ?? 0;
  const skipped = r?.skipped_dates?.length ?? 0;
  const off = r?.skipped_off_days?.length ?? 0;
  return `${made} lesson plan${made === 1 ? '' : 's'} created${skipped ? `, ${skipped} day${skipped === 1 ? '' : 's'} already had one` : ''}${off ? `, ${off} off day${off === 1 ? '' : 's'} skipped` : ''}.`;
}

export function bulkConflictText(data: { error?: string; conflict_dates?: string[] } | undefined): string | null {
  if (!data?.conflict_dates?.length) return null;
  return `${data.error ?? 'Some days already have a lesson plan.'} Days: ${data.conflict_dates.join(', ')}.`;
}
