// Pure logic for the phone's block paper builder (Paper Builder v2, Phase 6). The block data itself is handled by
// shared/blockDocument.js, a generated copy of the web's own file; this file holds what is particular to the phone
// screens: which control each server field gets, save state words, the paper details sent with ensure-draft and
// autosave, picture thumbnails, the photo-scan review and printing choices. Mirrors the web's
// frontend/src/pages/examinations/blocks/{BlockPaperEditor,BlockForm,PicturePicker,BlockScanReview}.jsx.
import { blockSpec, isQuestionBlock, type Block, type FieldSpec, type Registry } from './shared/blockDocument';
import type { PaperForm } from './paperBuilder';

export const SAVE_DELAY_MS = 1200;

// Papers and worksheets share the block editor (Phase 6b). A worksheet is practice: no office table or total
// unless the teacher turns them on, and its blocks may have no marks.
export type DocKind = 'paper' | 'worksheet';
export const kindNoun = (kind: DocKind = 'paper'): string => (kind === 'worksheet' ? 'worksheet' : 'paper');
export function headerSwitchOn(header: Record<string, unknown> | null | undefined, name: string, kind: DocKind = 'paper'): boolean {
  const value = (header ?? {})[name];
  return kind === 'worksheet' ? value === true : value !== false;
}

export type SaveState = 'saved' | 'pending' | 'saving' | 'error';

export const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'All changes saved', pending: 'Unsaved changes…', saving: 'Saving…', error: 'Not saved',
};

export const KIND_GROUPS = [
  { kind: 'text', label: 'Written questions (any class)' },
  { kind: 'activity', label: 'Activities (drawings, early years)' },
  { kind: 'layout', label: 'Layout' },
] as const;

export function formatMarks(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/** The server's validation messages for a document ({ document: [...] }), or null for any other failure. */
export function problemsFromError(error: unknown): string[] | null {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data) as { document?: unknown };
      return Array.isArray(parsed?.document) ? parsed.document.map(String) : null;
    } catch {
      return null;
    }
  }
  const list = (data as { document?: unknown } | undefined)?.document;
  return Array.isArray(list) ? list.map(String) : null;
}

/** Messages that name no question ("Question 3: ...") are shown above the outline. */
export const generalProblems = (problems: string[]): string[] => problems.filter((p) => !/^Question \d+:/.test(p));

// ------------------------------------------------------------------ the form, from the server's field list

export type FieldControl = 'richtext' | 'text' | 'number' | 'bool' | 'choice' | 'picture' | 'text_list' | 'letter_rows' | 'list' | 'unsupported';

export function fieldControl(field: FieldSpec): FieldControl {
  switch (field.kind) {
    case 'richtext': return 'richtext';
    case 'text': return 'text';
    case 'int':
    case 'number': return 'number';
    case 'bool': return 'bool';
    case 'choice': return Array.isArray(field.choices) ? 'choice' : 'unsupported';
    case 'picture': return 'picture';
    case 'text_list': return 'text_list';
    case 'letter_rows': return 'letter_rows';
    case 'list': return 'list';
    default: return 'unsupported';
  }
}

export const fieldLabel = (field: FieldSpec): string => `${field.label}${field.optional ? ' (optional)' : ''}`;

/** A number box's text -> the stored value (blank: nothing for an optional field, else the minimum). */
export function numberFromInput(text: string, field: FieldSpec): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === '-') return field.optional ? undefined : (field.min ?? 0);
  const n = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(n)) return field.optional ? undefined : (field.min ?? 0);
  return field.kind === 'int' ? Math.round(n) : n;
}

export function listSingular(field: FieldSpec): string {
  if (field.name === 'options') return 'option';
  if (field.name === 'rows') return 'row';
  return 'part';
}

export function listItemLabel(field: FieldSpec, index: number): string {
  if (field.name === 'options') return `Option ${String.fromCharCode(65 + index)}`;
  const word = listSingular(field);
  return `${word[0].toUpperCase()}${word.slice(1)} ${index + 1}`;
}

/** letter_rows: [['a','b'],['c']] <-> "a b\nc" (one row per line, letters split by spaces), as on the web. */
export function letterRowsToText(value: unknown): string {
  return (Array.isArray(value) ? value : []).map((row) => (Array.isArray(row) ? row.join(' ') : '')).join('\n');
}

export function textToLetterRows(text: string): string[][] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => line.split(/\s+/));
}

/** Plain text of a rich-text value, for the one-line summary shown before the editor opens. */
export function richSummary(html: unknown): string {
  return String(html ?? '')
    .replace(/<span[^>]*data-latex="([^"]*)"[^>]*>.*?<\/span>/g, ' $1 ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Set (or with undefined, drop) one key of an object, without changing the original. */
export function withKey<T extends Record<string, any>>(obj: T | undefined, name: string, value: unknown): T {
  const next = { ...(obj ?? {}) } as Record<string, unknown>;
  if (value === undefined) delete next[name];
  else next[name] = value;
  return next as T;
}

export const setBlockData = (block: Block, name: string, value: unknown): Block => ({ ...block, data: withKey(block.data, name, value) });

export function moveItem<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

/** New blocks go after the selected one (or at the end), as on the web. */
export function insertBlocks(blocks: Block[], selectedIndex: number, added: Block[]): Block[] {
  const list = [...blocks];
  list.splice(selectedIndex >= 0 ? selectedIndex + 1 : list.length, 0, ...added);
  return list;
}

/** After a delete: the block below, else the one above, else nothing. */
export function nextSelection(blocks: Block[], removedIndex: number): string | null {
  return blocks[removedIndex + 1]?.id ?? blocks[removedIndex - 1]?.id ?? null;
}

// ------------------------------------------------------------------ paper details

/**
 * Paper details for ensure-draft and autosave on a block paper. Total marks are left out (the server adds them up
 * from the blocks), and so are the old builder's structure and answer-lines option, which block papers do not use.
 */
export function blockSetupPayload(f: PaperForm) {
  return {
    paper_title: f.title.trim(),
    class_obj: f.classObj,
    subject: f.subject,
    exam: f.exam ?? null,
    instructions: f.instructions,
    ...(f.duration.trim() ? { duration_minutes: Number(f.duration) } : {}),
  };
}

/**
 * Setup's note under an empty class list. A teacher sees only the classes they teach (the server filters
 * them), so for a teacher an empty list means no assignment yet, not a school without classes.
 */
export function emptyClassMessage(persona: string | null | undefined): string {
  return persona === 'teacher'
    ? 'No classes are assigned to you. Ask your school admin to assign you a class and subject.'
    : 'This school has no classes set up yet. Add them on the website first.';
}

// ------------------------------------------------------------------ pictures

/** The phone cannot draw SVG in an Image, so a library picture is asked for as its PNG copy. */
export function thumbUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!url.includes('/paper-picture-library/')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}format=png`;
}

export const PICTURE_MAX_BYTES = 8 * 1024 * 1024;

/** Same rule as the server's picture upload (PNG, JPG or WebP, up to 8 MB). */
export function pictureFileProblem(mime: string | null | undefined, size: number | null | undefined): string | null {
  if (mime && !/^image\/(png|jpe?g|webp)$/.test(mime)) return 'Choose a PNG, JPG or WebP picture.';
  if (size && size > PICTURE_MAX_BYTES) return 'The picture is larger than 8 MB.';
  return null;
}

// ------------------------------------------------------------------ photo scan review

export interface BlockScanResult {
  scan_mode?: string;
  blocks?: Block[];
  header?: { total_marks?: number | string | null; [key: string]: unknown };
  notes?: string[];
  pictures?: { library?: number; cropped?: number };
  direction?: string;
}

export const keptBlocks = (blocks: Block[], skipped: number[]): Block[] => blocks.filter((_, i) => !skipped.includes(i));

export function scanMarks(blocks: Block[], registry: Registry | null | undefined): number {
  return blocks.reduce((sum, b) => sum + (isQuestionBlock(b, registry) ? Number(b.marks) || 0 : 0), 0);
}

/** The marks line under the review, or null when the photo showed no total. */
export function marksCheck(marks: number, printedTotal: unknown): { ok: boolean; text: string } | null {
  const total = Number(printedTotal) || null;
  if (!total) return null;
  return marks === total
    ? { ok: true, text: `${marks} / ${total} marks: the questions add up to the total on the paper.` }
    : { ok: false, text: `The questions add up to ${marks} marks; the paper says ${total}. Check the marks in the editor.` };
}

export function scanSummary(result: BlockScanResult, pageCount: number): string {
  const n = result.blocks?.length ?? 0;
  const pages = Math.max(1, pageCount);
  const pics = result.pictures ?? {};
  const pictureLine = pics.library || pics.cropped ? ` Pictures: ${pics.library || 0} from the library, ${pics.cropped || 0} cut from the photo.` : '';
  return `${n} question${n === 1 ? '' : 's'} read from ${pages} page${pages === 1 ? '' : 's'}.${pictureLine} Untick anything that is wrong; you can fix the rest in the editor.`;
}

/** "Q3 · Count and write · page 2" for one review card (headings are not numbered). */
export function scanCardLine(block: Block, number: number | null, registry: Registry | null | undefined, pageCount: number): string {
  const label = blockSpec(registry, block.type)?.label ?? block.type;
  const page = block.page_number && pageCount > 1 ? ` · page ${block.page_number}` : '';
  return `${number ? `Q${number} · ` : ''}${label}${page}`;
}

// ------------------------------------------------------------------ preview and printing

/**
 * The paper page is laid out for A4 (174 mm text width). A phone screen is narrower, so the preview is told to lay it
 * out 720 px wide and the WebView scales that down to the screen, showing the whole width as it will print.
 */
/**
 * The "still to fill" list from a refused print, PDF, Word or answer key: a draft is printed only once nothing is
 * left to fill (server print_problems, Structure step). Word answers come back as bytes. Null for other errors.
 */
export function stillToFillFromError(error: unknown): string[] | null {
  let data = (error as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof ArrayBuffer) {
    try { data = new TextDecoder().decode(data); } catch { return null; }
  }
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return null; }
  }
  const list = (data as { document?: unknown } | undefined)?.document;
  if (!Array.isArray(list) || !list.some((line) => String(line).startsWith('Still to fill'))) return null;
  return list.map((line) => String(line).replace(/^Still to fill: /, ''));
}

/** The message the page sends when a question is tapped on it (server PREVIEW_SCRIPT): its block id. */
export function pickedBlock(message: unknown): string | null {
  let data = message;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return null; }
  }
  const id = (data as { paperBlock?: unknown } | null)?.paperBlock;
  return typeof id === 'string' && id ? id : null;
}

export function previewPage(html: string): string {
  if (!html) return html;
  const meta = '<meta name="viewport" content="width=720">';
  // The server page asks for width=device-width (right for a browser tab); the preview replaces it.
  if (/<meta[^>]+name=["']viewport["'][^>]*>/i.test(html)) return html.replace(/<meta[^>]+name=["']viewport["'][^>]*>/i, meta);
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${meta}`) : `${meta}${html}`;
}

/** The answer key's PDF name: the paper's name plus "answer key" (letters of any script are kept). */
export function answerKeyFileName(title: string): string {
  return `${(title || 'Paper').replace(/[^\p{L}\p{M}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'Paper'}_answer_key.pdf`;
}

/** What to tell the teacher when the answer key cannot be made. 403: they may not edit this paper. */
export function answerKeyErrorMessage(error: unknown): string | null {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status === 403 ? 'Only the school admin, the principal and this class’s teachers can see the answer key.' : null;
}

