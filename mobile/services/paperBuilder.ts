// Paper details for the phone's paper builder (Setup step) and the papers list; port of the details part of
// frontend/src/pages/examinations/QuestionPaperBuilderPage.jsx. The questions are the block list
// (services/blockPaper.ts, components/content/blocks/). The old picked-questions and sections model was removed in
// Paper Builder v2 Phase 7; every paper, old or new, opens in the block editor and prints on the phone.

export interface PaperQuestionRow {
  id: number;
  question: number;
  question_order: number;
  marks_override?: number | string | null;
  marks?: number | string;
  question_text: string;
  question_type?: string;
  section_key?: string;
  bloom_level?: string | null;
  question_snapshot?: { bloom_level?: string | null } | null;
}

// Questions used in several papers already, as the paper detail lists them.
export interface OverusedRow { question_id: number; paper_use_count: number }

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
  exam?: number | null;
  render_options?: { answer_lines?: boolean } | null;
  // True once the paper is saved as blocks. Every paper prints on the phone from print-html either way (Phase 7).
  uses_blocks?: boolean;
  overused_questions?: OverusedRow[];
  created_at?: string;
}

export const PAPER_STATUSES = [{ value: 'DRAFT', label: 'Draft' }, { value: 'READY', label: 'Ready' }, { value: 'PUBLISHED', label: 'Published' }] as const;

// Only a draft can be edited (as on the web); a ready or published paper opens locked until it is reopened as a draft.
export const isLockedStatus = (status: string | null | undefined): boolean => !!status && status !== 'DRAFT';

export const paperTone = (s: string): 'neutral' | 'info' | 'success' => (s === 'PUBLISHED' ? 'success' : s === 'READY' ? 'info' : 'neutral');

export interface PaperForm {
  title: string;
  classObj: number | null;
  subject: number | null;
  duration: string;
  instructions: string;
  status: string;
  // The exam this paper belongs to (optional) and the print option that draws ruled lines under answers.
  exam: number | null;
  answerLines: boolean;
  // The Total Marks typed in Setup (as on the web, default 100); the sections and questions are checked against it.
  totalMarks: string;
}

export const emptyPaperForm = (): PaperForm => ({ title: '', classObj: null, subject: null, duration: '60', instructions: '', status: 'DRAFT', exam: null, answerLines: false, totalMarks: '100' });

export const paperToForm = (p: Paper): PaperForm => ({
  title: p.paper_title, classObj: p.class_obj, subject: p.subject, duration: p.duration_minutes != null ? String(p.duration_minutes) : '', instructions: p.instructions ?? '', status: p.status,
  exam: p.exam ?? null, answerLines: !!p.render_options?.answer_lines,
  totalMarks: p.total_marks != null && Number(p.total_marks) > 0 ? String(Number(p.total_marks)) : '100',
});

export function paperFileName(title: string): string {
  // Letters of any script are kept, so an Urdu paper's file is named in Urdu.
  const base = (title || 'Paper').replace(/[^\p{L}\p{M}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'Paper';
  return `${base}.pdf`;
}

// Step 1 (Setup) on its own, so the wizard can stop there before the structure.
export function validateSetup(f: PaperForm): string | null {
  if (!f.title.trim()) return 'Enter the paper title.';
  if (!f.classObj) return 'Choose the class.';
  if (!f.subject) return 'Choose the subject.';
  if (f.duration.trim() && (!/^\d+$/.test(f.duration.trim()) || Number(f.duration) < 1)) return 'Duration must be a whole number of minutes.';
  if (f.totalMarks.trim() && !(Number(f.totalMarks) > 0)) return 'Total marks must be a number above zero.';
  return null;
}
