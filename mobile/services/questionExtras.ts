// Pure logic for the rest of the question bank and paper builder: search by meaning, AI questions and
// verifying them, subject tags, selecting and deleting several papers, Word files, the paper's exam and
// automatic title, and the coverage panel. Port of frontend/src/pages/examinations (QuestionsPage,
// ExamPapersPage, QuestionPaperBuilderPage, BankFillSource); the server re-checks every rule.

// ─── Question list ─────────────────────────────────────────────────────────────────────────

export const SEARCH_MODES = [{ value: 'keyword', label: 'Keyword' }, { value: 'meaning', label: 'By meaning' }] as const;
export type SearchMode = (typeof SEARCH_MODES)[number]['value'];

export interface ListFilters { search?: string; subject?: number | null; type?: string; difficulty?: string; bloom?: string; tagId?: number | null }

// Only the filters the server really applies: it ignores is_ai_generated / verified_by__isnull, so the web's
// "AI source" filter shows every question whatever it is set to, and mobile does not offer one.
export function questionListParams(f: ListFilters, page: number): Record<string, unknown> {
  return {
    page, page_size: 20,
    ...(f.search ? { search: f.search } : {}), ...(f.subject ? { subject: f.subject } : {}),
    ...(f.type ? { question_type: f.type } : {}), ...(f.difficulty ? { difficulty: f.difficulty } : {}),
    ...(f.bloom ? { bloom_level: f.bloom } : {}), ...(f.tagId ? { tag_id: f.tagId } : {}),
  };
}

// The web waits 600 ms after typing, needs a class, and asks for 50 hits.
export const SEMANTIC_DEBOUNCE_MS = 600;
export function semanticParams(q: string, classId: number | null, subject: number | null): Record<string, unknown> {
  return { q, limit: 50, ...(classId ? { class_id: classId } : {}), ...(subject ? { subject } : {}) };
}

export interface SemanticHit {
  id: number; question_text: string; question_type: string; difficulty_level?: string; marks?: string | number;
  chapter_title?: string; topic_title?: string; book_title?: string;
}

// The server answers a bare array; the web also accepts { results } or { questions }.
export function semanticHitsOf(data: unknown): SemanticHit[] {
  if (Array.isArray(data)) return data as SemanticHit[];
  const d = data as { results?: unknown; questions?: unknown } | null;
  const list = d?.results ?? d?.questions;
  return Array.isArray(list) ? (list as SemanticHit[]) : [];
}

export const hitContext = (h: SemanticHit): string => [h.book_title, h.chapter_title, h.topic_title].filter(Boolean).join(' > ');

// ─── AI questions ──────────────────────────────────────────────────────────────────────────

export type AiStatus = 'verified' | 'unverified' | null;

export function aiStatus(q: { is_ai_generated?: boolean; verified_by?: number | null }): AiStatus {
  if (!q.is_ai_generated) return null;
  return q.verified_by ? 'verified' : 'unverified';
}

export const aiLabel = (s: AiStatus): string => (s === 'verified' ? 'AI · Verified' : s === 'unverified' ? 'AI · Unverified' : '');

// What the web sends to mark an AI question as checked by a person.
export const verifyPayload = (userId: number, now: Date = new Date()) => ({ verified_by: userId, verified_at: now.toISOString() });

// ─── Tags on a question ────────────────────────────────────────────────────────────────────

export interface SubjectTag { id: number; name: string; tag_type?: string }

export const toggleId = (ids: number[], id: number): number[] => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

export const newTagPayload = (name: string, subjectId: number) => ({ name: name.trim(), tag_type: 'keyword', subject: subjectId });

export function filterTags(tags: SubjectTag[], needle: string): SubjectTag[] {
  const n = needle.trim().toLowerCase();
  return n ? tags.filter((t) => t.name.toLowerCase().includes(n)) : tags;
}

// A tag the person typed that is not in the list yet can be created, once.
export const canCreateTag = (tags: SubjectTag[], needle: string): boolean =>
  needle.trim() !== '' && !tags.some((t) => t.name.trim().toLowerCase() === needle.trim().toLowerCase());

// ─── Several papers ────────────────────────────────────────────────────────────────────────

export const selectedAll = (rowIds: number[], selected: number[]): boolean => rowIds.length > 0 && rowIds.every((id) => selected.includes(id));

export const toggleAll = (rowIds: number[], selected: number[]): number[] => (selectedAll(rowIds, selected) ? selected.filter((id) => !rowIds.includes(id)) : [...new Set([...selected, ...rowIds])]);

export const bulkDeleteMessage = (n: number): string => `Delete ${n} paper${n === 1 ? '' : 's'}? This cannot be undone.`;

// Papers bulk delete answers { deleted: [ids], skipped: [{ id, reason }] }: a paper that is not found or not
// the person's to delete is skipped, with the reason.
export function bulkDeleteResult(data: unknown): string {
  const d = data as { deleted?: number[]; skipped?: Array<{ reason?: string }> } | null;
  const n = d?.deleted?.length ?? 0;
  const skipped = d?.skipped ?? [];
  const base = `${n} paper${n === 1 ? '' : 's'} deleted.`;
  return skipped.length ? `${base} ${skipped.length} skipped: ${[...new Set(skipped.map((x) => x.reason).filter(Boolean))].join(' ')}` : base;
}

export function docxFileName(title: string): string {
  const base = (title || 'Paper').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'Paper';
  return `${base}.docx`;
}

// ─── The paper's exam and title ────────────────────────────────────────────────────────────

export interface ExamOption { id: number; name?: string; exam_type_name?: string; start_date?: string | null }

// "Mid-Term (Term exam) - 3 Nov 2026": the exam's name, its type if different, and a safe date.
export function examOptionLabel(e: ExamOption): string {
  const parts = [e.name || e.exam_type_name || `Exam #${e.id}`];
  if (e.exam_type_name && e.exam_type_name !== e.name) parts.push(`(${e.exam_type_name})`);
  if (e.start_date) {
    const d = new Date(`${e.start_date}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) parts.push(`- ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`);
  }
  return parts.join(' ');
}

// The title follows "Exam - Class - Subject" until the person types their own (or clears it).
export const autoPaperTitle = (examLabel: string, className: string, subjectName: string): string =>
  [examLabel, className, subjectName].filter(Boolean).join(' - ');

// ─── Coverage panel ────────────────────────────────────────────────────────────────────────

export interface Slo { id: number; code?: string; statement?: string }
export interface PlannedTopic { topic_id: number; chapter?: string; topic?: string; is_covered: boolean; slos: Slo[] }
export interface CoverageStats {
  linked_lesson_plans?: Array<{ id: number; title?: string; lesson_date?: string | null }>;
  planned_topics_coverage?: PlannedTopic[];
  slo_coverage_count?: number;
}

// Learning objectives across the linked lesson plans, and which the paper's questions reach.
export function coverageView(stats: CoverageStats | null | undefined) {
  const topics = stats?.planned_topics_coverage ?? [];
  const byId = new Map<number, Slo>();
  const covered = new Set<number>();
  topics.forEach((t) => (t.slos ?? []).forEach((s) => {
    if (!byId.has(s.id)) byId.set(s.id, s);
    if (t.is_covered) covered.add(s.id);
  }));
  const all = [...byId.values()];
  const coveredList = all.filter((s) => covered.has(s.id));
  const uncovered = all.filter((s) => !covered.has(s.id));
  const coveredCount = coveredList.length || Number(stats?.slo_coverage_count ?? 0);
  return {
    total: all.length, covered: coveredList, uncovered, coveredCount,
    percent: all.length > 0 ? Math.min(100, Math.round((coveredCount / all.length) * 100)) : 0,
    linkedIds: (stats?.linked_lesson_plans ?? []).map((p) => p.id),
  };
}

export const sloText = (s: Slo): string => `${s.code || `SLO-${s.id}`} ${s.statement ?? ''}`.trim();

export const BLOOM_ORDER = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create', 'unclassified'] as const;

// How the paper's questions spread over thinking levels; more than 70% remember and understand is flagged.
export function bloomMix(rows: Array<{ bloom_level?: string | null }>) {
  const counts: Record<string, number> = Object.fromEntries(BLOOM_ORDER.map((k) => [k, 0]));
  rows.forEach((r) => {
    const key = String(r.bloom_level || '').toLowerCase();
    counts[counts[key] !== undefined ? key : 'unclassified'] += 1;
  });
  const total = rows.length;
  const percent = (k: string) => (total > 0 ? Number(((counts[k] / total) * 100).toFixed(1)) : 0);
  const surface = percent('remember') + percent('understand');
  return { total, counts, percent: Object.fromEntries(BLOOM_ORDER.map((k) => [k, percent(k)])) as Record<string, number>, surfaceHeavy: surface > 70, surfacePercent: surface };
}

// ─── Lesson plans linked to a paper ────────────────────────────────────────────────────────

export interface LessonOption { id: number; title: string; lesson_date?: string | null; planned_topics?: Array<{ id: number; title?: string; topic_number?: number | string }> }

// The topics of the chosen lesson plans, each once; the bank picker is narrowed to them.
export function topicsOfLessons(lessons: LessonOption[], chosen: number[]): Array<{ id: number; title?: string; topic_number?: number | string }> {
  const map = new Map<number, { id: number; title?: string; topic_number?: number | string }>();
  lessons.filter((l) => chosen.includes(l.id)).forEach((l) => (l.planned_topics ?? []).forEach((t) => map.set(t.id, t)));
  return [...map.values()];
}

export const lessonLine = (l: LessonOption): string => `${l.lesson_date || 'No date'} • ${(l.planned_topics ?? []).length} topic(s)`;

// Linking is only sent when the chosen set differs from what the server already has.
export const sameIds = (a: number[], b: number[]): boolean => a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === [...b].sort((x, y) => x - y)[i]);
