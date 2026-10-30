// Pure logic for building a question paper from the question bank; port of the core of
// frontend/src/pages/examinations/QuestionPaperBuilderPage.jsx and the rules in
// backend/examinations (ExamPaperCreateUpdateSerializer). Admin, principal, teacher and manager
// may build papers, with sections (question groups with "attempt any N", and printed dividers).
// AI fill, picture-paper extraction and lesson-plan links stay on the web; the PDF is the
// server's own, the same file the web downloads.

import type { Question } from './questionBank';

export interface PaperQuestionRow {
  id: number;
  question: number;
  question_order: number;
  marks_override?: number | string | null;
  marks?: number | string;
  question_text: string;
  question_type?: string;
  section_key?: string;
}

export interface Paper {
  id: number;
  paper_title: string;
  instructions?: string;
  total_marks: number | string;
  duration_minutes?: number | null;
  status: 'DRAFT' | 'READY' | 'PUBLISHED' | string;
  class_obj: number;
  class_name?: string;
  subject: number;
  subject_name?: string;
  paper_questions?: PaperQuestionRow[];
  structure?: Array<Record<string, unknown>>;
  created_at?: string;
}

export const PAPER_STATUSES = [{ value: 'DRAFT', label: 'Draft' }, { value: 'READY', label: 'Ready' }, { value: 'PUBLISHED', label: 'Published' }] as const;

export const paperTone = (s: string): 'neutral' | 'info' | 'success' => (s === 'PUBLISHED' ? 'success' : s === 'READY' ? 'info' : 'neutral');

export interface PickedQuestion {
  question: number;
  text: string;
  type: string;
  // The bank's own marks, and an optional per-paper change.
  bankMarks: number;
  override: string;
  // The section (structure key) this question sits in; '' = not in a section.
  sectionKey: string;
}

export const pickedFromQuestion = (q: Question): PickedQuestion => ({
  question: q.id, text: q.question_text, type: q.question_type, bankMarks: Number(q.marks) || 0, override: '', sectionKey: '',
});

export const pickedFromPaperRow = (r: PaperQuestionRow): PickedQuestion => ({
  question: r.question, text: r.question_text, type: r.question_type ?? '', bankMarks: Number(r.marks) || 0,
  override: r.marks_override != null && r.marks_override !== '' && Number(r.marks_override) !== Number(r.marks) ? String(Number(r.marks_override)) : '',
  sectionKey: r.section_key ?? '',
});

export const marksOf = (p: Pick<PickedQuestion, 'bankMarks' | 'override'>): number =>
  p.override.trim() !== '' && Number(p.override) >= 0 ? Number(p.override) : p.bankMarks;

export const totalMarks = (picked: PickedQuestion[]): number => Math.round(picked.reduce((s, p) => s + marksOf(p), 0) * 100) / 100;

export const addQuestion = (picked: PickedQuestion[], q: Question): PickedQuestion[] =>
  picked.some((p) => p.question === q.id) ? picked : [...picked, pickedFromQuestion(q)];

export const removeQuestion = (picked: PickedQuestion[], id: number): PickedQuestion[] => picked.filter((p) => p.question !== id);

export function moveQuestion(picked: PickedQuestion[], index: number, delta: -1 | 1): PickedQuestion[] {
  const to = index + delta;
  if (to < 0 || to >= picked.length) return picked;
  const next = [...picked];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

export interface PaperForm {
  title: string;
  classObj: number | null;
  subject: number | null;
  duration: string;
  instructions: string;
  status: string;
}

export const emptyPaperForm = (): PaperForm => ({ title: '', classObj: null, subject: null, duration: '60', instructions: '', status: 'DRAFT' });

export const paperToForm = (p: Paper): PaperForm => ({
  title: p.paper_title, classObj: p.class_obj, subject: p.subject, duration: p.duration_minutes != null ? String(p.duration_minutes) : '', instructions: p.instructions ?? '', status: p.status,
});

export function paperFileName(title: string): string {
  const base = (title || 'Paper').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'Paper';
  return `${base}.pdf`;
}

export const sortPapers = (list: Paper[]): Paper[] => [...list].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '') || b.id - a.id);

// ─── Sections ──────────────────────────────────────────────────────────────────────────────

export interface Section {
  key: string;
  type: 'question_group' | 'divider';
  title: string;
  instruction: string;
  question_type: string;
  slotsShown: number;
  slotsCounted: number;
  marksPerQuestion: number;
  // True while the instruction is the generated "Attempt any N questions." line.
  autoInstruction: boolean;
}

export const SECTION_TYPES = ['MCQ', 'SHORT', 'LONG', 'ESSAY', 'TRUE_FALSE', 'MATCHING', 'FILL_BLANK'];

let counter = 0;
const newKey = () => `sec_${Date.now()}_${(counter += 1)}_${Math.random().toString(36).slice(2, 6)}`;

export const autoInstruction = (counted: number) => `Attempt any ${counted} questions.`;

export function makeSection(index: number, over: Partial<Section> = {}): Section {
  const shown = over.slotsShown ?? 5;
  const counted = over.slotsCounted ?? shown;
  const choice = counted !== shown;
  return {
    key: over.key ?? newKey(), type: 'question_group', title: over.title ?? `Question # ${index + 1}`,
    instruction: over.instruction ?? (choice ? autoInstruction(counted) : ''), question_type: over.question_type ?? 'SHORT',
    slotsShown: shown, slotsCounted: counted, marksPerQuestion: over.marksPerQuestion ?? 1, autoInstruction: over.autoInstruction ?? choice,
  };
}

// A printed separator such as "Section - A"; no marks or questions attach to it.
export function makeDivider(index: number): Section {
  return { key: newKey(), type: 'divider', title: `Section - ${String.fromCharCode(65 + (index % 26))}`, instruction: '', question_type: '', slotsShown: 0, slotsCounted: 0, marksPerQuestion: 0, autoInstruction: false };
}

const groups = (sections: Section[]) => sections.filter((s) => s.type !== 'divider');

// Same starter layout as the web: ten multiple choice, five short, and long answers filling the rest.
export function autoDistribution(totalInput: number | string): Section[] {
  const total = Number(totalInput) > 0 ? Number(totalInput) : 100;
  const mcq = makeSection(0, { title: 'Question # 1', question_type: 'MCQ', slotsShown: 10, marksPerQuestion: 1 });
  const short = makeSection(1, { title: 'Question # 2', question_type: 'SHORT', slotsShown: 5, marksPerQuestion: 4 });
  const remaining = Math.max(total - (mcq.slotsCounted * 1 + short.slotsCounted * 4), 8);
  const longCount = Math.max(1, Math.round(remaining / 8));
  const long = makeSection(2, { title: 'Question # 3', question_type: 'LONG', slotsShown: longCount, marksPerQuestion: Number((remaining / longCount).toFixed(2)) });
  return [mcq, short, long];
}

// Marks the sections add up to: questions to attempt times marks each (dividers add nothing).
export const allocatedMarks = (sections: Section[]): number =>
  Math.round(groups(sections).reduce((n, s) => n + s.slotsCounted * s.marksPerQuestion, 0) * 100) / 100;

export function setSlotsShown(s: Section, value: string): Section {
  const shown = Math.max(0, parseInt(value, 10) || 0);
  const counted = s.slotsCounted !== s.slotsShown ? Math.min(s.slotsCounted, shown) : shown;
  const next = { ...s, slotsShown: shown, slotsCounted: counted };
  return next.autoInstruction && counted !== shown ? { ...next, instruction: autoInstruction(counted) } : next;
}

export function setSlotsCounted(s: Section, value: string): Section {
  const counted = Math.min(s.slotsShown, Math.max(0, parseInt(value, 10) || 0));
  return { ...s, slotsCounted: counted, instruction: s.autoInstruction ? autoInstruction(counted) : s.instruction };
}

// "Choice" means more questions are shown than must be answered.
export function setChoice(s: Section, on: boolean): Section {
  if (on) {
    const counted = Math.max(1, s.slotsShown - 1);
    return { ...s, slotsCounted: counted, autoInstruction: s.autoInstruction || !s.instruction, instruction: s.autoInstruction || !s.instruction ? autoInstruction(counted) : s.instruction };
  }
  return { ...s, slotsCounted: s.slotsShown, instruction: s.autoInstruction ? '' : s.instruction, autoInstruction: false };
}

export const isChoice = (s: Section) => s.type !== 'divider' && s.slotsCounted !== s.slotsShown;

export function moveSection(sections: Section[], index: number, delta: -1 | 1): Section[] {
  const to = index + delta;
  if (to < 0 || to >= sections.length) return sections;
  const next = [...sections];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

// What the server stores in ExamPaper.structure.
export function serializeStructure(sections: Section[]) {
  return sections.map((s) => (s.type === 'divider'
    ? { key: s.key, type: 'divider', title: s.title }
    : {
      key: s.key, type: 'question_group', title: s.title, instruction: s.instruction, question_type: s.question_type,
      slots_shown: s.slotsShown, slots_counted: s.slotsCounted, marks_per_question: s.marksPerQuestion,
    }));
}

export function hydrateStructure(structure: Array<Record<string, unknown>> | undefined | null): Section[] {
  if (!Array.isArray(structure)) return [];
  return structure.map((raw, i) => {
    const key = String(raw.key ?? `sec_${i}`);
    if (raw.type === 'divider') return { ...makeDivider(i), key, title: String(raw.title || 'Section') };
    const shown = Number(raw.slots_shown ?? 0) || 0;
    const counted = Number(raw.slots_counted ?? shown) || 0;
    return {
      key, type: 'question_group', title: String(raw.title || `Q${i + 1}`), instruction: String(raw.instruction ?? ''),
      question_type: String(raw.question_type || 'SHORT'), slotsShown: shown, slotsCounted: counted,
      marksPerQuestion: Number(raw.marks_per_question ?? 0) || 0, autoInstruction: false,
    };
  });
}

// ─── Questions in sections ─────────────────────────────────────────────────────────────────

export const assignSection = (picked: PickedQuestion[], id: number, sectionKey: string): PickedQuestion[] =>
  picked.map((p) => (p.question === id ? { ...p, sectionKey } : p));

// A section whose key has gone (deleted) leaves its questions loose rather than lost.
export function dropSection(sections: Section[], picked: PickedQuestion[], key: string) {
  return { sections: sections.filter((s) => s.key !== key), picked: picked.map((p) => (p.sectionKey === key ? { ...p, sectionKey: '' } : p)) };
}

export const countIn = (picked: PickedQuestion[], key: string) => picked.filter((p) => p.sectionKey === key).length;

// Save order: sections in order (each keeping its own order), then questions in no section.
export function orderForSave(picked: PickedQuestion[], sections: Section[]): PickedQuestion[] {
  const keys = groups(sections).map((s) => s.key);
  const ordered: PickedQuestion[] = [];
  for (const k of keys) ordered.push(...picked.filter((p) => p.sectionKey === k));
  ordered.push(...picked.filter((p) => !keys.includes(p.sectionKey)));
  return ordered;
}

// With sections the total follows them; without, it is the sum of the chosen questions.
export const paperTotal = (picked: PickedQuestion[], sections: Section[]): number =>
  groups(sections).length > 0 ? allocatedMarks(sections) : totalMarks(picked);

export function validatePaper(f: PaperForm, picked: PickedQuestion[], sections: Section[] = []): string | null {
  if (!f.title.trim()) return 'Enter the paper title.';
  if (!f.classObj) return 'Choose the class.';
  if (!f.subject) return 'Choose the subject.';
  if (f.duration.trim() && (!/^\d+$/.test(f.duration.trim()) || Number(f.duration) < 1)) return 'Duration must be a whole number of minutes.';
  if (picked.length === 0) return 'Add at least one question.';
  if (picked.some((p) => p.override.trim() !== '' && !(Number(p.override) >= 0))) return 'A marks change must be a number, zero or more.';
  for (const sec of groups(sections)) {
    if (!sec.title.trim()) return 'Every section needs a title.';
    if (!SECTION_TYPES.includes(sec.question_type)) return `Choose a question type for "${sec.title}".`;
    if (sec.slotsShown < 1) return `"${sec.title}" needs at least one question.`;
    if (sec.slotsCounted < 1 || sec.slotsCounted > sec.slotsShown) return `"${sec.title}": questions to attempt must be between 1 and ${sec.slotsShown}.`;
    if (!(sec.marksPerQuestion > 0)) return `"${sec.title}": marks per question must be above zero.`;
    const n = countIn(picked, sec.key);
    if (n > sec.slotsShown) return `"${sec.title}" holds ${n} questions but shows ${sec.slotsShown}. Remove some or raise the number shown.`;
  }
  return null;
}

// Step 1 of saving: create or refresh the draft paper (details and structure).
export function buildEnsurePayload(f: PaperForm, picked: PickedQuestion[], sections: Section[]) {
  return {
    paper_title: f.title.trim(),
    class_obj: f.classObj,
    subject: f.subject,
    instructions: f.instructions.trim(),
    ...(f.duration.trim() ? { duration_minutes: Number(f.duration) } : {}),
    total_marks: paperTotal(picked, sections),
    structure: serializeStructure(sections),
  };
}

// Step 2: the questions in save order, each with its section and any marks change.
export function buildAutosavePayload(f: PaperForm, picked: PickedQuestion[], sections: Section[]) {
  return {
    ...buildEnsurePayload(f, picked, sections),
    manual_questions: orderForSave(picked, sections).map((p, i) => ({
      question_id: p.question,
      question_order: i + 1,
      section_key: p.sectionKey,
      marks_override: p.override.trim() !== '' ? Number(p.override) : null,
    })),
  };
}

// The status the paper ends up in once saved; the server only autosaves a draft, so a paper that
// is not a draft is put back to draft first and restored afterwards.
export function statusSteps(current: string | null, target: string): { first: boolean; last: boolean } {
  return { first: !!current && current !== 'DRAFT', last: target !== 'DRAFT' };
}

// Warning shown before saving when the sections add up to a different total than the questions do.
export function reconcileNote(picked: PickedQuestion[], sections: Section[]): string | null {
  if (groups(sections).length === 0) return null;
  const chosen = totalMarks(picked);
  const planned = allocatedMarks(sections);
  return chosen !== planned ? `The sections add up to ${planned} marks; the questions chosen add up to ${chosen}.` : null;
}
