// Per-question answers of one student on one paper (port of the web StudentResponsePage): what the
// student wrote, the marks given and right/wrong. Only questions with something entered are sent;
// the server creates or updates one row per question.

export interface PaperQuestionLite {
  id: number; question: number; question_text?: string; question_type?: string; marks?: number | string | null;
  marks_override?: number | string | null; correct_answer?: string | null;
}

export interface ResponseDraft { text: string; marks: string; correct: boolean | null }
export type DraftMap = Record<number, ResponseDraft>;

export const emptyDraft = (): ResponseDraft => ({ text: '', marks: '', correct: null });

export function plainQuestion(html?: string | null): string {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

export const questionMarks = (q: PaperQuestionLite) => q.marks_override ?? q.marks ?? null;

export interface SavedResponse { question: number; response_text?: string; marks_awarded?: number | string | null; is_correct?: boolean | null }

export function draftsFromSaved(rows: SavedResponse[]): DraftMap {
  const map: DraftMap = {};
  rows.forEach((r) => {
    const id = Number(r.question);
    if (!Number.isFinite(id)) return;
    map[id] = { text: r.response_text || '', marks: r.marks_awarded == null ? '' : String(Number(r.marks_awarded)), correct: typeof r.is_correct === 'boolean' ? r.is_correct : null };
  });
  return map;
}

export function validateDrafts(questions: PaperQuestionLite[], drafts: DraftMap): string | null {
  for (const [i, q] of questions.entries()) {
    const d = drafts[q.question];
    if (!d || d.marks.trim() === '') continue;
    const n = Number(d.marks);
    if (!Number.isFinite(n) || n < 0) return `Question ${i + 1}: marks must be a number, 0 or more.`;
    const max = questionMarks(q);
    if (max != null && n > Number(max)) return `Question ${i + 1}: at most ${Number(max)} marks.`;
  }
  return null;
}

// Rows the web would send: skip questions with nothing entered at all.
export function responseRows(questions: PaperQuestionLite[], drafts: DraftMap) {
  return questions.flatMap((q) => {
    const d = drafts[q.question];
    if (!d) return [];
    const marks = d.marks.trim() === '' ? null : Number(d.marks);
    if (!d.text.trim() && marks === null && d.correct === null) return [];
    return [{ question: q.question, response_text: d.text, marks_awarded: marks, is_correct: d.correct }];
  });
}

export const savedMessage = (reply: { created_count?: number; updated_count?: number } | undefined) =>
  `Saved: ${reply?.created_count ?? 0} added, ${reply?.updated_count ?? 0} updated.`;

export function enteredCount(rows: Array<{ student?: number }>): number {
  return new Set(rows.map((r) => Number(r.student)).filter((n) => Number.isFinite(n))).size;
}
