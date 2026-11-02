// Pure logic for worksheets: practice and homework sheets, a sibling of question papers with no exam, marks
// total or duration. Port of frontend/src/pages/examinations/WorksheetsPage.jsx and WorksheetBuilderPage.jsx,
// and the rules in backend/examinations (WorksheetDraftEnsureSerializer, WorksheetDraftAutosaveSerializer).
// The server re-checks everything; a worksheet that is not a draft cannot be changed.

import type { Question } from './questionBank';

export interface WorksheetItemRow {
  id: number;
  question: number | null;
  item_order: number;
  section_key?: string;
  marks_override?: number | string | null;
  question_text: string;
  question_type?: string;
  option_a?: string; option_b?: string; option_c?: string; option_d?: string;
  correct_answer?: string;
  answer_text?: string;
  type_data?: Record<string, unknown> | null;
  question_image_url?: string | null;
}

export interface Worksheet {
  id: number;
  title: string;
  class_obj: number;
  class_name?: string;
  subject?: number | null;
  subject_name?: string;
  instructions?: string;
  structure?: Array<Record<string, unknown>>;
  render_options?: Record<string, unknown> | null;
  items?: WorksheetItemRow[];
  item_count?: number;
  status: 'DRAFT' | 'READY' | 'PUBLISHED' | string;
  source?: string;
  created_at?: string;
}

export const WORKSHEET_STATUSES = [{ value: 'DRAFT', label: 'Draft' }, { value: 'READY', label: 'Ready' }, { value: 'PUBLISHED', label: 'Published' }] as const;

export const worksheetTone = (s: string): 'neutral' | 'info' | 'success' => (s === 'PUBLISHED' ? 'success' : s === 'READY' ? 'info' : 'neutral');

export const isDraft = (w: Pick<Worksheet, 'status'>): boolean => w.status === 'DRAFT';

// Matching needs its two columns in type_data, which the worksheet form has no editor for.
export const WORKSHEET_TYPES = ['MCQ', 'SHORT', 'LONG', 'ESSAY', 'TRUE_FALSE', 'FILL_BLANK'] as const;

// ─── New worksheet ─────────────────────────────────────────────────────────────────────────

export interface NewWorksheetForm { title: string; classObj: number | null; subject: number | null }

export const emptyNewWorksheet = (): NewWorksheetForm => ({ title: '', classObj: null, subject: null });

export const validateNewWorksheet = (f: NewWorksheetForm): string | null => (f.classObj ? null : 'Choose the class.');

// The class is the master class; the subject is optional ("no specific subject").
export const buildEnsurePayload = (f: NewWorksheetForm) => ({
  class_obj: f.classObj, subject: f.subject || undefined, title: f.title.trim() || 'Untitled Worksheet', source: 'MANUAL',
});

// ─── Items ─────────────────────────────────────────────────────────────────────────────────

export interface WorksheetItem {
  localId: string;
  question: number | null;
  text: string;
  type: string;
  marks: string;
  correct: string;
  answerText: string;
  typeData: Record<string, unknown>;
  options: { A: string; B: string; C: string; D: string };
  sectionKey: string;
  imageUrl: string | null;
}

let counter = 0;
export const newLocalId = (): string => `new_${Date.now()}_${(counter += 1)}`;

export const emptyItem = (sectionKey = ''): WorksheetItem => ({
  localId: '', question: null, text: '', type: 'SHORT', marks: '', correct: '', answerText: '', typeData: {},
  options: { A: '', B: '', C: '', D: '' }, sectionKey, imageUrl: null,
});

export const itemFromRow = (r: WorksheetItemRow): WorksheetItem => ({
  localId: `existing_${r.id}`, question: r.question ?? null, text: r.question_text || '', type: r.question_type || 'SHORT',
  marks: r.marks_override != null && r.marks_override !== '' ? String(Number(r.marks_override)) : '', correct: r.correct_answer || '', answerText: r.answer_text || '',
  typeData: (r.type_data as Record<string, unknown>) || {},
  options: { A: r.option_a || '', B: r.option_b || '', C: r.option_c || '', D: r.option_d || '' },
  sectionKey: r.section_key || '', imageUrl: r.question_image_url || null,
});

// A question taken from the bank keeps its link to it and its own marks (the sheet shows marks only if asked).
export const itemFromQuestion = (q: Question): WorksheetItem => ({
  localId: newLocalId(), question: q.id, text: q.question_text, type: q.question_type, marks: '', correct: q.correct_answer || '',
  answerText: q.answer_text || '', typeData: (q.type_data as Record<string, unknown>) || {},
  options: { A: q.option_a || '', B: q.option_b || '', C: q.option_c || '', D: q.option_d || '' }, sectionKey: '', imageUrl: q.question_image_url ?? null,
});

export function validateItem(i: WorksheetItem): string | null {
  if (!i.text.trim()) return 'Question text is required.';
  if (i.marks.trim() && !(Number(i.marks) >= 0)) return 'Marks must be a number.';
  if (i.type === 'MCQ') {
    if (!i.options.A.trim() || !i.options.B.trim()) return 'A multiple choice question needs at least options A and B.';
    const key = i.correct.trim().toUpperCase();
    if (key && !['A', 'B', 'C', 'D'].includes(key)) return 'The correct option must be A, B, C or D.';
  }
  if (i.type === 'TRUE_FALSE' && i.correct.trim() && !['true', 'false'].includes(i.correct.trim().toLowerCase())) return 'The answer must be True or False.';
  return null;
}

export const removeItem = (items: WorksheetItem[], localId: string): WorksheetItem[] => items.filter((i) => i.localId !== localId);

export function moveItem(items: WorksheetItem[], index: number, delta: -1 | 1): WorksheetItem[] {
  const to = index + delta;
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

export const assignItemSection = (items: WorksheetItem[], localId: string, sectionKey: string): WorksheetItem[] =>
  items.map((i) => (i.localId === localId ? { ...i, sectionKey } : i));

// Questions the bank picker should leave out: those already on the sheet.
export const excludedQuestionIds = (items: WorksheetItem[]): number[] => items.map((i) => i.question).filter((q): q is number => !!q);

// When a section is removed its items stay on the sheet, unassigned.
export const unassignSection = (items: WorksheetItem[], sectionKey: string): WorksheetItem[] =>
  items.map((i) => (i.sectionKey === sectionKey ? { ...i, sectionKey: '' } : i));

export const countInSection = (items: WorksheetItem[], key: string): number => items.filter((i) => i.sectionKey === key).length;

// ─── Autosave ──────────────────────────────────────────────────────────────────────────────

export interface WorksheetDraft { title: string; instructions: string; structure: Array<Record<string, unknown>>; renderOptions: Record<string, unknown> }

export const draftFromWorksheet = (w: Worksheet): WorksheetDraft => ({
  title: w.title || '', instructions: w.instructions || '', structure: w.structure || [], renderOptions: w.render_options || {},
});

// The whole draft goes up each time: details, structure and every item in order. The server upserts the items into the
// worksheet and the question bank, so an item with no question id becomes a bank question.
export function buildAutosavePayload(d: WorksheetDraft, items: WorksheetItem[]) {
  return {
    title: d.title, instructions: d.instructions, structure: d.structure, render_options: d.renderOptions,
    manual_items: items.map((i, n) => ({
      question_id: i.question,
      item_order: n + 1,
      section_key: i.sectionKey || '',
      marks_override: i.marks.trim() === '' ? null : Number(i.marks),
      question_text: i.text,
      question_type: i.type,
      correct_answer: i.correct,
      answer_text: i.answerText,
      type_data: i.typeData,
      option_a: i.options.A || '', option_b: i.options.B || '', option_c: i.options.C || '', option_d: i.options.D || '',
    })),
  };
}

// A cheap fingerprint so autosave only fires when something changed.
export const draftKey = (d: WorksheetDraft, items: WorksheetItem[]): string => JSON.stringify(buildAutosavePayload(d, items));

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';
export const saveLabel = (s: SaveState, status: string): string => (s === 'saving' ? 'Saving…' : s === 'saved' ? 'Saved' : s === 'error' ? 'Save failed' : status);

// ─── Files ─────────────────────────────────────────────────────────────────────────────────

export function worksheetFileName(title: string, ext: 'pdf' | 'docx'): string {
  const base = (title || 'Worksheet').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'Worksheet';
  return `${base}.${ext}`;
}

export const sortWorksheets = (list: Worksheet[]): Worksheet[] => [...list].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '') || b.id - a.id);
