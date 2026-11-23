// Pure logic for worksheets: practice and homework sheets, a sibling of question papers with no exam, marks
// total or duration. Port of frontend/src/pages/examinations/WorksheetsPage.jsx and WorksheetBuilderPage.jsx,
// and the rules in backend/examinations (WorksheetDraftEnsureSerializer, WorksheetDraftAutosaveSerializer).
// The server re-checks everything; a worksheet that is not a draft cannot be changed. The items are the block list
// (services/blockPaper.ts); the old item editor's helpers were removed in Paper Builder v2 Phase 7.

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
  made_by_name?: string | null;
  source?: string;
  /** Saved as blocks (Phase 6b). Every worksheet prints on the phone from print-html either way (Phase 7). */
  uses_blocks?: boolean;
  created_at?: string;
}

export const WORKSHEET_STATUSES = [{ value: 'DRAFT', label: 'Draft' }, { value: 'READY', label: 'Ready' }, { value: 'PUBLISHED', label: 'Published' }] as const;

export const worksheetTone = (s: string): 'neutral' | 'info' | 'success' => (s === 'PUBLISHED' ? 'success' : s === 'READY' ? 'info' : 'neutral');

export const isDraft = (w: Pick<Worksheet, 'status'>): boolean => w.status === 'DRAFT';

// ─── New worksheet ─────────────────────────────────────────────────────────────────────────

export interface NewWorksheetForm { title: string; classObj: number | null; subject: number | null }

export const emptyNewWorksheet = (): NewWorksheetForm => ({ title: '', classObj: null, subject: null });

// The subject is needed since worksheets use the block editor: every question is kept in the bank under a subject.
export const validateNewWorksheet = (f: NewWorksheetForm): string | null => (!f.classObj ? 'Choose the class.' : !f.subject ? 'Choose the subject.' : null);

// The class is the master class.
export const buildEnsurePayload = (f: NewWorksheetForm) => ({
  class_obj: f.classObj, subject: f.subject || undefined, title: f.title.trim() || 'Untitled Worksheet', source: 'MANUAL',
});

// ─── Files ─────────────────────────────────────────────────────────────────────────────────

export function worksheetFileName(title: string, ext: 'pdf' | 'docx'): string {
  const base = (title || 'Worksheet').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'Worksheet';
  return `${base}.${ext}`;
}


// ─── Block worksheet details (Phase 6b) ────────────────────────────────────────────────────

export interface WorksheetDetails { title: string; instructions: string; subject: number | null }

export const detailsFromWorksheet = (w: Worksheet): WorksheetDetails => ({ title: w.title ?? '', instructions: w.instructions ?? '', subject: w.subject ?? null });

/** What the details step autosaves (the blocks are saved by the editor). */
export const detailsPayload = (d: WorksheetDetails) => ({
  title: d.title.trim() || 'Untitled Worksheet', instructions: d.instructions, ...(d.subject ? { subject: d.subject } : {}),
});
