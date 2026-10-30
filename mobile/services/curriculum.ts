// Pure logic for curriculum authoring (books, chapters, topics) and the table-of-contents scan;
// port of frontend/src/pages/lms/CurriculumPage.jsx and AddBookModal.jsx, and the rules in
// backend/lms (CanEditCurriculum: admin, principal, teacher and manager may write).

export interface BookForm {
  title: string;
  classObj: number | null;
  subject: number | null;
  author: string;
  publisher: string;
  edition: string;
  language: string;
}

export const LANGUAGES = [{ value: 'en', label: 'English' }, { value: 'ur', label: 'Urdu' }] as const;

export const emptyBookForm = (): BookForm => ({ title: '', classObj: null, subject: null, author: '', publisher: '', edition: '', language: 'en' });

export function validateBook(f: BookForm): string | null {
  if (!f.title.trim()) return 'Enter the book title.';
  if (!f.classObj) return 'Choose the class.';
  if (!f.subject) return 'Choose the subject.';
  return null;
}

export function buildBookPayload(f: BookForm, schoolId: number) {
  return {
    school: schoolId,
    class_obj: f.classObj,
    subject: f.subject,
    title: f.title.trim(),
    author: f.author.trim(),
    publisher: f.publisher.trim(),
    edition: f.edition.trim(),
    language: f.language,
    is_active: true,
  };
}

// ─── Chapters and topics ───────────────────────────────────────────────────────────────────

export interface ChapterForm { title: string; number: string; pageStart: string; pageEnd: string }
export interface TopicForm { title: string; number: string; pageStart: string; pageEnd: string; kind: 'general' | 'exercise' }

export const emptyChapterForm = (next: number): ChapterForm => ({ title: '', number: String(next), pageStart: '', pageEnd: '' });
export const emptyTopicForm = (next: number): TopicForm => ({ title: '', number: String(next), pageStart: '', pageEnd: '', kind: 'general' });

const whole = (t: string) => t.trim() === '' || /^\d+$/.test(t.trim());

function pagesProblem(start: string, end: string): string | null {
  if (!whole(start) || !whole(end)) return 'Page numbers must be whole numbers.';
  if (start.trim() && end.trim() && Number(end) < Number(start)) return 'The last page is before the first page.';
  return null;
}

export function validateChapter(f: ChapterForm): string | null {
  if (!f.title.trim()) return 'Enter the chapter title.';
  if (!/^\d+$/.test(f.number.trim()) || Number(f.number) < 1) return 'Enter the chapter number (1 or more).';
  return pagesProblem(f.pageStart, f.pageEnd);
}

export function validateTopic(f: TopicForm): string | null {
  if (!f.title.trim()) return 'Enter the topic title.';
  if (!/^\d+$/.test(f.number.trim()) || Number(f.number) < 1) return 'Enter the topic number (1 or more).';
  return pagesProblem(f.pageStart, f.pageEnd);
}

const pageOrNull = (t: string) => (t.trim() ? Number(t) : null);

export function buildChapterPayload(f: ChapterForm, bookId: number | null) {
  return {
    ...(bookId ? { book: bookId } : {}),
    title: f.title.trim(), chapter_number: Number(f.number), page_start: pageOrNull(f.pageStart), page_end: pageOrNull(f.pageEnd),
  };
}

export function buildTopicPayload(f: TopicForm, chapterId: number | null) {
  return {
    ...(chapterId ? { chapter: chapterId } : {}),
    title: f.title.trim(), topic_number: Number(f.number), page_start: pageOrNull(f.pageStart), page_end: pageOrNull(f.pageEnd), content_kind: f.kind,
  };
}

// The next free number among the existing ones, as the web suggests when adding.
export const nextNumber = (existing: Array<number | string | undefined | null>): number =>
  Math.max(0, ...existing.map((n) => Number(n) || 0)) + 1;

// ─── Table-of-contents scan ────────────────────────────────────────────────────────────────

export type TocJobState = 'working' | 'done' | 'failed';

// QUEUED and PROCESSING keep waiting; SUCCEEDED is done; FAILED and TIMED_OUT end the wait.
export function tocJobState(status: string | undefined): TocJobState {
  if (status === 'SUCCEEDED') return 'done';
  if (status === 'FAILED' || status === 'TIMED_OUT') return 'failed';
  return 'working';
}

// Poll quickly at first, then ease off; give up after about two minutes (the upload itself has a
// two minute limit on the web too).
export const TOC_POLL_LIMIT_MS = 120_000;
export const tocPollDelay = (attempt: number): number => (attempt < 5 ? 1500 : 3000);

export const TOC_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const TOC_MAX_BYTES = 10 * 1024 * 1024;

export function tocImageProblem(mime: string | undefined, size: number | undefined): string | null {
  if (mime && !TOC_ALLOWED_TYPES.includes(mime)) return 'Use a JPEG, PNG or WebP photo.';
  if (size && size > TOC_MAX_BYTES) return 'The photo is too large. Take it again at a lower quality.';
  return null;
}

export interface TocTopic { title: string; page_start?: number | null; page_end?: number | null; content_kind?: string }
export interface TocChapter { title: string; page_start?: number | null; page_end?: number | null; topics: TocTopic[] }

export const tocCounts = (chapters: TocChapter[]) => ({
  chapters: chapters.length,
  topics: chapters.reduce((n, c) => n + (c.topics?.length ?? 0), 0),
});

export const removeTocChapter = (chapters: TocChapter[], index: number): TocChapter[] => chapters.filter((_, i) => i !== index);

export const removeTocTopic = (chapters: TocChapter[], ci: number, ti: number): TocChapter[] =>
  chapters.map((c, i) => (i === ci ? { ...c, topics: c.topics.filter((_, j) => j !== ti) } : c));

export const renameTocChapter = (chapters: TocChapter[], index: number, title: string): TocChapter[] =>
  chapters.map((c, i) => (i === index ? { ...c, title } : c));

// A fresh key per apply attempt; the server returns the first result again if a flaky connection
// makes the app resend the same request, so chapters are never created twice.
export function applyPayload(chapters: TocChapter[], key: string) {
  return {
    chapters: chapters.filter((c) => c.title.trim()).map((c) => ({
      title: c.title.trim(), page_start: c.page_start ?? null, page_end: c.page_end ?? null,
      topics: (c.topics ?? []).filter((t) => t.title.trim()).map((t) => ({ ...t, title: t.title.trim() })),
    })),
    idempotency_key: key,
  };
}

export function applyResultText(r: { chapters_created?: number; topics_created?: number; errors?: string[] } | undefined): string {
  const c = r?.chapters_created ?? 0;
  const t = r?.topics_created ?? 0;
  const e = r?.errors?.length ?? 0;
  return `Added ${c} chapter${c === 1 ? '' : 's'} and ${t} topic${t === 1 ? '' : 's'}${e ? `; ${e} could not be added` : ''}.`;
}
