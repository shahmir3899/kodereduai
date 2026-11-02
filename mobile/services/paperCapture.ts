// Pure logic for capturing a printed paper or worksheet from photos: one page at a time, each read in the
// background by the server (OCR and an AI reading), reviewed and edited, then accepted into the builder. Port of
// frontend/src/pages/examinations/ImageCapturePaperTab.jsx and the worksheet ScanTab, and of the contracts in
// backend/examinations (PaperUploadViewSet, WorksheetUploadViewSet, paper_ocr_processor).

import { makeSection, type Section } from './paperBuilder';
import { tocImageProblem } from './curriculum';
import type { WorksheetItem } from './worksheets';

export type UploadStatus = 'PENDING' | 'PROCESSING' | 'EXTRACTED' | 'REVIEWED' | 'CONFIRMED' | 'FAILED';

export interface ExtractedQuestion {
  question_text?: string;
  question_type?: string;
  options?: { A?: string; B?: string; C?: string; D?: string } | null;
  marks?: number | string | null;
  type_data?: Record<string, unknown> | null;
}

export interface ExtractedSection {
  title?: string;
  instruction?: string;
  question_type_guess?: string;
  shown_count?: number | string | null;
  counted_count?: number | string | null;
  marks_per_question?: number | string | null;
  questions?: ExtractedQuestion[];
}

export interface Extracted {
  header?: { exam_title?: string | null; detected_total_marks?: number | null; duration_label?: string | null };
  sections?: ExtractedSection[];
  computed_total_marks?: number | null;
}

export interface Upload {
  id: number;
  status: UploadStatus | string;
  group_id?: string | null;
  page_number: number;
  ai_extracted_json?: Extracted | null;
  error_message?: string | null;
  extraction_confidence?: number | null;
}

export const POLL_MS = 2500;
export const isTerminal = (status: string | undefined): boolean => status === 'EXTRACTED' || status === 'FAILED';

// JPEG, PNG or WebP, up to 10 MB: the same limits as the web dropzone.
export const captureImageProblem = tocImageProblem;

// "1.5 hours" -> 90, "45 minutes" -> 45; an unreadable label is left to the person.
export function parseDurationMinutes(label: string | null | undefined): number | null {
  if (!label) return null;
  const text = String(label).toLowerCase();
  const m = text.match(/(\d+(\.\d+)?)/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (Number.isNaN(v)) return null;
  return Math.round(text.includes('hour') ? v * 60 : v);
}

// ─── Review state ──────────────────────────────────────────────────────────────────────────

export interface ReviewQuestion {
  localId: string;
  sectionKey: string;
  text: string;
  type: string;
  marks: string;
  options: { A: string; B: string; C: string; D: string };
  typeData: Record<string, unknown>;
}

export interface CapturePage {
  pageNumber: number;
  uploadId: number | null;
  status: 'uploading' | 'processing' | 'extracted' | 'failed';
  questionCount: number;
  marks: number;
  error: string;
}

export interface CaptureHeader { title: string; totalMarks: string; duration: string }

export interface CaptureState {
  groupId: string | null;
  pages: CapturePage[];
  header: CaptureHeader;
  sections: Section[];
  questions: ReviewQuestion[];
}

export const emptyCapture = (): CaptureState => ({
  groupId: null, pages: [], header: { title: '', totalMarks: '100', duration: '60' }, sections: [], questions: [],
});

// The server answered the upload: remember the group (the same one is sent with every later page) and wait for the reading.
export function registerPage(s: CaptureState, upload: Pick<Upload, 'id' | 'group_id' | 'page_number'>): CaptureState {
  return {
    ...s,
    groupId: s.groupId ?? upload.group_id ?? null,
    pages: ([...s.pages.filter((p) => p.pageNumber !== upload.page_number), { pageNumber: upload.page_number, uploadId: upload.id, status: 'processing', questionCount: 0, marks: 0, error: '' }] as CapturePage[])
      .sort((a, b) => a.pageNumber - b.pageNumber),
  };
}

export const markFailed = (s: CaptureState, uploadId: number, message: string): CaptureState => ({
  ...s, pages: s.pages.map((p) => (p.uploadId === uploadId ? { ...p, status: 'failed', error: message || 'Please try again with a clearer photo.' } : p)),
});

// A failed page goes, so its retry can reuse the page number instead of leaving a gap (Page 1, Page 3).
export const dropPage = (s: CaptureState, pageNumber: number): CaptureState => ({ ...s, pages: s.pages.filter((p) => p.pageNumber !== pageNumber) });

export const allocatedMarks = (sections: Section[]): number =>
  Math.round(sections.filter((x) => x.type !== 'divider').reduce((sum, x) => sum + x.slotsCounted * x.marksPerQuestion, 0) * 100) / 100;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

let counter = 0;
const localId = (page: number, key: string, i: number) => `ocr_p${page}_${key || 'none'}_${i}_${Date.now()}_${(counter += 1)}`;

// One reading turned into sections and questions, with keys that carry the page number so pages can never collide.
export function applyExtraction(s: CaptureState, upload: Pick<Upload, 'id' | 'page_number' | 'ai_extracted_json'>): CaptureState {
  const data = upload.ai_extracted_json ?? {};
  const header = data.header ?? {};
  const page = upload.page_number;
  const newSections: Section[] = [];
  const newQuestions: ReviewQuestion[] = [];
  (data.sections ?? []).forEach((sec, i) => {
    const shown = num(sec.shown_count);
    const counted = sec.counted_count != null && sec.counted_count !== '' ? num(sec.counted_count) : shown;
    const key = `sec_p${page}_${i}_${Date.now()}_${(counter += 1)}`;
    newSections.push(makeSection(i, {
      key, title: sec.title || `Q${i + 1}`, instruction: sec.instruction || '', question_type: sec.question_type_guess || 'SHORT',
      slotsShown: shown, slotsCounted: counted || shown, marksPerQuestion: num(sec.marks_per_question),
    }));
    (sec.questions ?? []).forEach((q, j) => {
      newQuestions.push({
        localId: localId(page, key, j), sectionKey: key, text: q.question_text || '', type: q.question_type || 'SHORT',
        marks: q.marks != null && q.marks !== '' ? String(num(q.marks) || 1) : String(num(sec.marks_per_question) || 1),
        options: { A: q.options?.A || '', B: q.options?.B || '', C: q.options?.C || '', D: q.options?.D || '' },
        typeData: q.type_data && typeof q.type_data === 'object' ? q.type_data : {},
      });
    });
  });
  const first = page === 1;
  return {
    ...s,
    // Only the first page's header fills the paper details; later pages rarely repeat it, and the person's edits win.
    header: first ? {
      title: header.exam_title || s.header.title,
      totalMarks: String(header.detected_total_marks ?? data.computed_total_marks ?? s.header.totalMarks),
      duration: String(parseDurationMinutes(header.duration_label) ?? s.header.duration),
    } : s.header,
    sections: [...s.sections, ...newSections],
    questions: [...s.questions, ...newQuestions],
    pages: s.pages.map((p) => (p.uploadId === upload.id ? { ...p, status: 'extracted', questionCount: newQuestions.length, marks: allocatedMarks(newSections) } : p)),
  };
}

export const hasExtractedPage = (s: CaptureState): boolean => s.pages.some((p) => p.status === 'extracted');

// A nudge, not a block: marks captured so far against the total printed on the paper.
export function marksNudge(s: CaptureState): string | null {
  const total = Number(s.header.totalMarks);
  if (!hasExtractedPage(s) || !(total > 0)) return null;
  const captured = allocatedMarks(s.sections);
  if (captured === total) return `All ${total} marks captured.`;
  return captured < total ? `${captured} of ${total} marks captured so far. Add the next page if the paper continues.` : `${captured} marks captured, more than the ${total} on the paper. Check the sections.`;
}

// ─── Editing the review ────────────────────────────────────────────────────────────────────

export const updateReview = (s: CaptureState, id: string, patch: Partial<ReviewQuestion>): CaptureState => ({
  ...s, questions: s.questions.map((q) => (q.localId === id ? { ...q, ...patch } : q)),
});

export const removeReview = (s: CaptureState, id: string): CaptureState => ({ ...s, questions: s.questions.filter((q) => q.localId !== id) });

// A section removed in review leaves its questions unplaced rather than losing them.
export const removeSection = (s: CaptureState, key: string): CaptureState => ({
  ...s, sections: s.sections.filter((x) => x.key !== key), questions: s.questions.map((q) => (q.sectionKey === key ? { ...q, sectionKey: '' } : q)),
});

export function validateReview(s: CaptureState): string | null {
  if (!hasExtractedPage(s)) return 'Capture at least one page first.';
  if (s.questions.length === 0) return 'There are no questions to add.';
  if (s.questions.some((q) => !q.text.trim())) return 'Every question needs its text. Fill in or remove the empty ones.';
  return null;
}

// ─── Handing the capture to a builder ──────────────────────────────────────────────────────

// A question for the bank: the paper builder works from bank questions, so each reviewed question is created there first.
export function bankQuestionPayload(q: ReviewQuestion, subject: number): Record<string, unknown> {
  return {
    subject, question_text: q.text.trim(), question_type: q.type, marks: Number(q.marks) > 0 ? Number(q.marks) : 1, difficulty_level: 'MEDIUM',
    correct_answer: '', answer_text: '', type_data: q.typeData,
    ...(q.type === 'MCQ' ? { option_a: q.options.A, option_b: q.options.B, option_c: q.options.C, option_d: q.options.D } : {}),
  };
}

// What the learning loop is told once the paper is saved: the reviewed questions, as the person left them.
export function confirmPayload(paperId: number, questions: ReviewQuestion[]) {
  return {
    exam_paper_id: paperId,
    confirmed_data: {
      questions: questions.map((q) => ({
        question_text: q.text.trim(), question_type: q.type, marks: Number(q.marks) || 1, section_key: q.sectionKey,
        options: q.options, type_data: q.typeData,
      })),
    },
  };
}

// A worksheet keeps its items inline (the server turns them into bank questions on autosave).
export function worksheetItems(questions: ReviewQuestion[], newId: () => string): WorksheetItem[] {
  return questions.map((q) => ({
    localId: newId(), question: null, text: q.text.trim(), type: q.type, marks: '', correct: '', answerText: '', typeData: q.typeData,
    options: { ...q.options }, sectionKey: q.sectionKey, imageUrl: null,
  }));
}

export const pageLabel = (p: CapturePage): string =>
  p.status === 'uploading' ? 'Uploading…' : p.status === 'processing' ? 'Reading the page…' : p.status === 'failed' ? 'Failed' : `${p.questionCount} question${p.questionCount === 1 ? '' : 's'}`;
