// Capturing a printed paper from photos with the page count declared up front: every page is uploaded and read at
// the same time, the server joins them (GET paper-uploads/group-status/), and the person reviews what was read in
// the order it arrives: the questions and their types, then the sections built from them, then the paper details.
// Port of frontend/src/pages/examinations/paperCaptureLogic.js; the server side is backend/examinations/paper_reconcile.py.

import { makeSection, type Section } from './paperBuilder';
import { parseDurationMinutes, type CaptureState, type ReviewQuestion } from './paperCapture';

export const MAX_PAGES = 30;
export const UPLOAD_CONCURRENCY = 3;
export const POLL_MS = 2500;

export interface ServerPage { page_number: number; upload_id: number | null; status: string; error_message: string; image_url?: string | null }

/** A question's area on its page photo, as 0-1 fractions of the image. */
export interface PhotoBox { x0: number; y0: number; x1: number; y1: number }
export interface PagePhoto { page_number: number; image_url: string }

export interface ReconciledQuestion {
  question_text?: string; question_type?: string; options?: { A?: string; B?: string; C?: string; D?: string } | null;
  marks?: number | string | null; type_data?: Record<string, unknown> | null; needs_review?: boolean;
  page_number?: number | null; box?: PhotoBox | null; uncertain?: string[];
}

export interface ReconciledSection {
  title?: string; instruction?: string | null; question_type_guess?: string; marks_per_question?: number | string | null;
  shown_count?: number | string | null; counted_count?: number | string | null; questions?: ReconciledQuestion[];
}

export interface Reconciled {
  header?: { exam_title?: string | null; class_label?: string | null; subject_label?: string | null; detected_total_marks?: number | null; duration_label?: string | null };
  sections?: ReconciledSection[];
  marks_check?: { detected: number | null; computed: number; matches: boolean | null };
  low_confidence_count?: number;
  warning?: string | null;
}

export interface GroupStatus { complete: boolean; pages: ServerPage[]; failed_pages: number[]; result: Reconciled | null }

export interface PageQuestion extends ReviewQuestion {
  needsReview: boolean;
  // Where the question was read from, for the photo viewer.
  pageNumber: number | null; box: PhotoBox | null; uncertain: string[];
}

export interface PagesReview {
  title: string; totalMarks: string; duration: string;
  classLabel: string; subjectLabel: string;
  sections: Section[]; questions: PageQuestion[];
  uploadIds: number[];
  warning?: string | null;
  photos?: PagePhoto[];
}

export interface PagesSession { groupId: string | null; totalPages: number | null; review: PagesReview | null }

export const emptyPagesSession = (): PagesSession => ({ groupId: null, totalPages: null, review: null });

export function newGroupId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const clampPages = (input: string): number => Math.max(1, Math.min(MAX_PAGES, parseInt(input, 10) || 1));

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

let counter = 0;
const uid = (prefix: string) => `${prefix}_${Date.now()}_${(counter += 1)}`;

// The reconciled paper -> sections, questions in paper order and the paper details.
export function buildReview(result: Reconciled, uploadIds: number[], photos: PagePhoto[] = []): PagesReview {
  const header = result.header ?? {};
  const sections: Section[] = [];
  const questions: PageQuestion[] = [];
  (result.sections ?? []).forEach((sec, i) => {
    const shown = num(sec.shown_count);
    const counted = sec.counted_count != null && sec.counted_count !== '' ? num(sec.counted_count) : shown;
    const key = uid('sec');
    sections.push(makeSection(i, {
      key, title: sec.title || `Q${i + 1}`, instruction: sec.instruction || '', question_type: sec.question_type_guess || 'SHORT',
      slotsShown: shown, slotsCounted: counted || shown, marksPerQuestion: num(sec.marks_per_question),
    }));
    (sec.questions ?? []).forEach((q) => {
      questions.push({
        localId: uid('ocr_q'), sectionKey: key, text: q.question_text || '', type: q.question_type || 'SHORT',
        marks: q.marks != null && q.marks !== '' ? String(num(q.marks) || 1) : String(num(sec.marks_per_question) || 1),
        options: { A: q.options?.A || '', B: q.options?.B || '', C: q.options?.C || '', D: q.options?.D || '' },
        typeData: q.type_data && typeof q.type_data === 'object' ? q.type_data : {},
        needsReview: Boolean(q.needs_review),
        pageNumber: q.page_number ?? null, box: q.box ?? null, uncertain: Array.isArray(q.uncertain) ? q.uncertain : [],
      });
    });
  });
  return {
    title: header.exam_title || '',
    // Left empty when the paper prints no total: the person must fill it before accepting.
    totalMarks: header.detected_total_marks != null ? String(header.detected_total_marks) : '',
    duration: String(parseDurationMinutes(header.duration_label) ?? 60),
    classLabel: header.class_label || '', subjectLabel: header.subject_label || '',
    sections, questions, uploadIds, warning: result.warning ?? null, photos,
  };
}

// The person corrected one question's type. A section holds one type, so a uniform section is split into runs of the
// same type, like the server does; an "attempt any N" section stays whole because the choice spans all of it.
export function changeQuestionType(review: PagesReview, localId: string, type: string): PagesReview {
  const target = review.questions.find((q) => q.localId === localId);
  if (!target || target.type === type) return review;
  const questions = review.questions.map((q) => (q.localId === localId ? { ...q, type, needsReview: false } : q));
  const row = review.sections.find((s) => s.key === target.sectionKey);
  if (!row || row.slotsCounted < row.slotsShown) return { ...review, questions };

  const runs: PageQuestion[][] = [];
  questions.filter((q) => q.sectionKey === row.key).forEach((q) => {
    if (runs.length && runs[runs.length - 1][0].type === q.type) runs[runs.length - 1].push(q);
    else runs.push([q]);
  });

  const keyOf = new Map<string, string>();
  const rows = runs.map((run, i) => {
    const key = i === 0 ? row.key : uid('sec');
    run.forEach((q) => keyOf.set(q.localId, key));
    const marks = new Set(run.map((q) => q.marks));
    return i === 0 && runs.length === 1
      ? { ...row, question_type: run[0].type, slotsShown: run.length, slotsCounted: run.length }
      : {
        ...row, key, title: i === 0 ? row.title : `${row.title} (${run[0].type})`, instruction: i === 0 ? row.instruction : '',
        question_type: run[0].type, slotsShown: run.length, slotsCounted: run.length,
        marksPerQuestion: marks.size === 1 ? num(run[0].marks) : row.marksPerQuestion,
      };
  });
  return {
    ...review,
    sections: review.sections.flatMap((s) => (s.key === row.key ? rows : [s])),
    questions: questions.map((q) => (keyOf.has(q.localId) ? { ...q, sectionKey: keyOf.get(q.localId) as string } : q)),
  };
}

export const needsCheck = (review: PagesReview): number => review.questions.filter((q) => q.needsReview).length;

// What must be filled in before accepting. Class and subject are chosen on the paper screen itself.
export function missingBeforeAccept(review: PagesReview): string[] {
  const missing: string[] = [];
  if (!review.title.trim()) missing.push('Paper title');
  if (!(Number(review.totalMarks) > 0)) missing.push('Total marks');
  if (review.questions.some((q) => !q.text.trim())) missing.push('Text of every question');
  return missing;
}

// The builder's accept step works from this shape.
export function toCaptureState(review: PagesReview): CaptureState {
  return {
    groupId: null,
    pages: review.uploadIds.map((id, i) => ({ pageNumber: i + 1, uploadId: id, status: 'extracted' as const, questionCount: 0, marks: 0, error: '' })),
    header: { title: review.title, totalMarks: review.totalMarks, duration: review.duration },
    sections: review.sections,
    questions: review.questions.map(({ needsReview: _flag, pageNumber: _page, box: _box, uncertain: _unsure, ...q }) => q),
  };
}

export type SlotState = 'empty' | 'queued' | 'uploading' | 'processing' | 'extracted' | 'failed';

export function slotState(local: 'queued' | 'uploading' | 'failed' | undefined, server: ServerPage | undefined): SlotState {
  if (local === 'queued' || local === 'uploading') return local;
  if (!server || server.status === 'MISSING') return local === 'failed' ? 'failed' : 'empty';
  if (server.status === 'EXTRACTED') return 'extracted';
  if (server.status === 'FAILED') return 'failed';
  return 'processing';
}

export const SLOT_LABEL: Record<SlotState, string> = {
  empty: 'No photo yet', queued: 'Waiting to upload…', uploading: 'Uploading…', processing: 'Reading the page…', extracted: 'Read', failed: 'Failed',
};
