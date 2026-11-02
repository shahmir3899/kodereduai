// Pure logic for the rest of the Curriculum page: editing a book, typed or AI-made contents, a topic's
// sub-topic text and content blocks (with revisions and tags), content search and syllabus progress.
// Port of frontend/src/pages/lms/CurriculumPage.jsx; the server (CanEditCurriculum: admin, principal,
// teacher and manager may write) re-checks every rule.

import type { TocChapter } from './curriculum';

// ─── Edit a book ───────────────────────────────────────────────────────────────────────────

export const BOOK_LANGUAGES = [
  { value: 'en', label: 'English' }, { value: 'ur', label: 'Urdu' }, { value: 'ar', label: 'Arabic' },
  { value: 'sd', label: 'Sindhi' }, { value: 'ps', label: 'Pashto' }, { value: 'pa', label: 'Punjabi' }, { value: 'other', label: 'Other' },
] as const;

export interface BookEditForm { title: string; author: string; publisher: string; edition: string; language: string; description: string }

export interface BookDetail {
  id: number; title?: string; author?: string; publisher?: string; edition?: string; language?: string; description?: string;
  class_obj?: number | null; subject?: number | null; class_name?: string; subject_name?: string;
}

export const bookToEditForm = (b: BookDetail): BookEditForm => ({
  title: b.title ?? '', author: b.author ?? '', publisher: b.publisher ?? '', edition: b.edition ?? '', language: b.language || 'en', description: b.description ?? '',
});

export const validateBookEdit = (f: BookEditForm): string | null => (f.title.trim() ? null : 'Enter the book title.');

// The web sends the whole form plus the school; the class and subject are not editable.
export function buildBookEditPayload(f: BookEditForm, schoolId: number | undefined): Record<string, unknown> {
  return {
    title: f.title.trim(), author: f.author.trim(), publisher: f.publisher.trim(), edition: f.edition.trim(),
    language: f.language, description: f.description.trim(), ...(schoolId ? { school: schoolId } : {}),
  };
}

// ─── Contents typed or made by AI ──────────────────────────────────────────────────────────

// Text above this goes to the chunked parse call, as on the web.
export const TOC_LARGE_TEXT = 50 * 1024;
export const TOC_MAX_TEXT = 500 * 1024;

type Label = 'chapter' | 'topic' | 'note' | 'exercise' | 'none';

// Lines written as "CHAPTER: …" or "TOPIC: …" skip the server: the structure is already in the text.
export function parseLabeledLines(text: string): Array<{ label: Label; text: string }> {
  return (text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const m = line.match(/^(chapter|topic|note|exercise)\s*:\s*(.*)$/i);
    return m ? { label: m[1].toLowerCase() as Label, text: (m[2] || '').trim() } : { label: 'none' as Label, text: line };
  });
}

export function buildTocFromLabeledText(text: string): { hasLabels: boolean; chapters: TocChapter[]; warnings: string[] } {
  const lines = parseLabeledLines(text);
  const hasLabels = lines.some((l) => l.label !== 'none');
  const chapters: TocChapter[] = [];
  const warnings: string[] = [];
  let current = -1;
  const ensureDefault = () => {
    if (current !== -1) return;
    chapters.push({ title: 'Untitled Chapter', topics: [], page_start: null, page_end: null });
    current = chapters.length - 1;
  };
  lines.forEach((line, index) => {
    const content = line.text.trim();
    if (!content) return;
    if (line.label === 'chapter') {
      chapters.push({ title: content, topics: [], page_start: null, page_end: null });
      current = chapters.length - 1;
    } else if (line.label === 'topic') {
      if (current === -1) warnings.push(`Line ${index + 1}: Topic found before chapter. Added under Untitled Chapter.`);
      ensureDefault();
      chapters[current].topics.push({ title: content, page_start: null, page_end: null, content_kind: 'general' });
    } else if (line.label === 'exercise') {
      ensureDefault();
      chapters[current].topics.push({ title: content, page_start: null, page_end: null, content_kind: 'exercise' });
    } else if (line.label === 'note') {
      ensureDefault(); // notes are kept out of the outline, as on the web they only ride along as notes
    } else if (current === -1) {
      chapters.push({ title: content, topics: [], page_start: null, page_end: null });
      current = chapters.length - 1;
    } else {
      chapters[current].topics.push({ title: content, page_start: null, page_end: null, content_kind: 'general' });
    }
  });
  return { hasLabels, chapters, warnings };
}

export interface OutlineResult { chapters: TocChapter[]; warnings: string[]; source: string; confidence: number | null }

const cleanChapters = (raw: unknown): TocChapter[] => (Array.isArray(raw) ? raw : []).map((c) => {
  const ch = c as { title?: string; topics?: Array<{ title?: string }> };
  return {
    title: ch.title || '', page_start: null, page_end: null,
    topics: (ch.topics || []).map((t) => ({ title: t.title || '', page_start: null, page_end: null, content_kind: 'general' })),
  };
});

// parse_toc and parse_toc_stream answer { chapters, warnings }.
export function outlineFromParse(data: unknown): OutlineResult {
  const d = data as { chapters?: unknown; warnings?: string[] } | null;
  return { chapters: cleanChapters(d?.chapters), warnings: d?.warnings ?? [], source: 'rule_based', confidence: null };
}

// suggest_toc answers { chapters, suggestions, confidence, source, warnings }. The web prefers `chapters`; when
// only the flat `suggestions` come back, they are grouped under their chapter titles.
export function outlineFromSuggestion(data: unknown): OutlineResult {
  const d = data as { chapters?: unknown; suggestions?: Array<{ kind?: string; title?: string; chapter_title?: string }>; confidence?: number; source?: string; warnings?: string[] } | null;
  const confidence = typeof d?.confidence === 'number' ? d.confidence : 0.7;
  let chapters = cleanChapters(d?.chapters);
  if (chapters.length === 0 && Array.isArray(d?.suggestions)) {
    const byTitle = new Map<string, TocChapter>();
    const order: TocChapter[] = [];
    d.suggestions.filter((s) => (s.title || '').trim()).forEach((s) => {
      const chapterTitle = (s.kind === 'topic' ? s.chapter_title : s.title) || s.title || '';
      let ch = byTitle.get(chapterTitle);
      if (!ch) { ch = { title: chapterTitle, topics: [], page_start: null, page_end: null }; byTitle.set(chapterTitle, ch); order.push(ch); }
      if (s.kind === 'topic') ch.topics.push({ title: (s.title as string).trim(), page_start: null, page_end: null, content_kind: 'general' });
    });
    chapters = order;
  }
  return { chapters, warnings: d?.warnings ?? [], source: d?.source || 'ai', confidence };
}

export const confidenceText = (c: number | null): string => (c == null ? '' : `${Math.round(c * 100)}% sure`);

// ─── A topic's sub-topics ──────────────────────────────────────────────────────────────────

export interface SubtopicForm { contentText: string; minutes: string }
export interface Subtopic { id: number; title: string; subtopic_number?: number; content_text?: string; estimated_minutes?: number | null }

export const subtopicToForm = (s: Subtopic): SubtopicForm => ({ contentText: s.content_text ?? '', minutes: s.estimated_minutes != null ? String(s.estimated_minutes) : '' });

export function validateSubtopic(f: SubtopicForm): string | null {
  if (f.minutes.trim() && !(Number.isInteger(Number(f.minutes)) && Number(f.minutes) >= 0)) return 'Minutes must be a whole number.';
  return null;
}

export const buildSubtopicPayload = (f: SubtopicForm) => ({
  content_text: f.contentText.trim(), estimated_minutes: f.minutes.trim() === '' ? null : parseInt(f.minutes, 10),
});

// ─── Content blocks ────────────────────────────────────────────────────────────────────────

export const BLOCK_TYPES = [
  { value: 'text', label: 'Text paragraph' }, { value: 'definition', label: 'Definition' }, { value: 'example', label: 'Worked example' },
  { value: 'exercise', label: 'Exercise' }, { value: 'formula', label: 'Formula / equation' }, { value: 'diagram_desc', label: 'Diagram description' },
  { value: 'summary', label: 'Summary' }, { value: 'key_point', label: 'Key point' },
] as const;

export const blockTypeLabel = (type?: string | null): string =>
  BLOCK_TYPES.find((t) => t.value === type)?.label ?? (type ? type.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : 'Text');

export interface ContentBlock {
  id: number; topic?: number | null; block_type: string; content_text: string; content_rich?: unknown;
  sequence_order?: number; difficulty_level?: number | null; estimated_minutes?: number | null; is_ai_generated?: boolean;
  tags?: Array<{ id: number; name: string; tag_type?: string }>;
}

export interface BlockForm { type: string; text: string; rich: string; sequence: string; difficulty: string; minutes: string }

// A new block goes after the last one.
export function emptyBlockForm(existing: ContentBlock[]): BlockForm {
  const max = existing.reduce((acc, b) => (Number.isFinite(Number(b.sequence_order)) ? Math.max(acc, Number(b.sequence_order)) : acc), 0);
  return { type: 'text', text: '', rich: '', sequence: String(max + 1), difficulty: '', minutes: '' };
}

export const blockToForm = (b: ContentBlock): BlockForm => ({
  type: b.block_type || 'text', text: b.content_text || '', rich: b.content_rich ? JSON.stringify(b.content_rich, null, 2) : '',
  sequence: Number.isFinite(Number(b.sequence_order)) ? String(b.sequence_order) : '1',
  difficulty: b.difficulty_level != null ? String(b.difficulty_level) : '', minutes: b.estimated_minutes != null ? String(b.estimated_minutes) : '',
});

const wholeOrBlank = (v: string) => !v.trim() || (Number.isInteger(Number(v)) && Number(v) >= 0);

export function validateBlock(f: BlockForm): string | null {
  if (!f.type) return 'Choose the block type.';
  if (!f.text.trim()) return 'Content text is required.';
  if (f.rich.trim()) {
    try { JSON.parse(f.rich); } catch { return 'Rich content must be valid JSON.'; }
  }
  if (!wholeOrBlank(f.sequence) || !wholeOrBlank(f.difficulty) || !wholeOrBlank(f.minutes)) return 'Order, difficulty and minutes must be whole numbers.';
  return null;
}

export function buildBlockPayload(f: BlockForm, topicId: number): Record<string, unknown> {
  return {
    topic: topicId, block_type: f.type, content_text: f.text.trim(),
    content_rich: f.rich.trim() ? JSON.parse(f.rich) : null,
    sequence_order: Math.max(0, parseInt(f.sequence, 10) || 0),
    difficulty_level: f.difficulty.trim() === '' ? null : parseInt(f.difficulty, 10),
    estimated_minutes: f.minutes.trim() === '' ? null : parseInt(f.minutes, 10),
  };
}

export const sortBlocks = (blocks: ContentBlock[]): ContentBlock[] =>
  [...blocks].sort((a, b) => Number(a.sequence_order ?? 0) - Number(b.sequence_order ?? 0) || a.id - b.id);

// ─── Revisions ─────────────────────────────────────────────────────────────────────────────

export interface BlockRevision { id: number; content_text: string; changed_by_name?: string; changed_at?: string; revision_note?: string }

export const revisionLine = (r: BlockRevision): string =>
  [r.changed_at ? r.changed_at.slice(0, 16).replace('T', ' ') : '', r.changed_by_name, r.revision_note].filter(Boolean).join('  ·  ');

// ─── Content search ────────────────────────────────────────────────────────────────────────

export interface SearchHit { id: number; block_type: string; content_text: string; similarity_score?: number; hierarchy_path?: string; topic_title?: string; chapter_title?: string }

// The server answers a bare array; the web also accepts { results }.
export function searchHitsOf(data: unknown): SearchHit[] {
  if (Array.isArray(data)) return data as SearchHit[];
  const r = (data as { results?: unknown } | null)?.results;
  return Array.isArray(r) ? (r as SearchHit[]) : [];
}

// ─── Syllabus progress ─────────────────────────────────────────────────────────────────────

export interface BookProgress { book_id: number; book_title?: string; total_topics: number; covered_topics: number; percentage: number }
export interface SyllabusProgress { total_topics: number; covered_topics: number; percentage?: number; books?: BookProgress[]; book_progress?: BookProgress[] }

export const progressPercent = (p: { total_topics?: number; covered_topics?: number } | null | undefined): number =>
  p && (p.total_topics ?? 0) > 0 ? Math.round(((p.covered_topics ?? 0) / (p.total_topics as number)) * 100) : 0;

export function progressForBook(p: SyllabusProgress | null | undefined, bookId: number): BookProgress | null {
  const list = p?.books ?? p?.book_progress ?? [];
  return list.find((b) => b.book_id === bookId) ?? null;
}
