// Types for blockDocument.js, a generated copy of the web's frontend/src/pages/examinations/blocks/blockDocument.js
// (scripts/build-rich-editor.mjs). Hand-written: keep in step when an exported function changes.

/** One field of a block type, as GET paper-blocks/ describes it (backend paper_blocks/registry.py). */
export interface FieldSpec {
  name: string;
  label: string;
  kind: 'text' | 'richtext' | 'int' | 'number' | 'bool' | 'choice' | 'picture' | 'text_list' | 'letter_rows' | 'list' | string;
  optional?: boolean;
  default?: unknown;
  min?: number;
  max?: number;
  max_length?: number;
  choices?: string[];
  /** Friendly words for ``choices``; the choice itself is what is stored. */
  labels?: Record<string, string>;
  help?: string;
  /** A numbers list: the editors offer "count 1 to N, a box empty every k". */
  counting?: boolean;
  fields?: FieldSpec[];
}

export interface BlockSpec {
  type: string;
  label: string;
  kind: 'text' | 'activity' | 'layout' | string;
  fields: FieldSpec[];
  /** Picker group (server TYPE_PICKING) and a one-line hint. */
  group?: string;
  hint?: string;
}

export interface Registry { blocks: BlockSpec[]; [key: string]: unknown }

export type PictureRef = string | { upload: number } | { url: string } | { make: string; [key: string]: unknown } | { crop: number[] };

export interface Block {
  id: string;
  type: string;
  title?: string;
  marks?: number;
  question_id?: number;
  page_number?: number;
  data?: Record<string, any>;
}

export interface BlockDocument {
  blocks: Block[];
  header?: Record<string, any>;
  direction?: 'ltr' | 'rtl' | string;
  [key: string]: unknown;
}

export const TEXT_DEFAULT_TITLES: Record<string, string>;
export const TYPE_TO_BLOCK: Record<string, string>;
export function newId(): string;
export function blockSpec(registry: Registry | null | undefined, type: string | undefined): BlockSpec | null;
export function isQuestionBlock(block: Block | null | undefined, registry: Registry | null | undefined): boolean;
export function defaultForField(field: FieldSpec): unknown;
export function newListItem(field: FieldSpec): Record<string, any>;
export function newBlock(type: string, registry: Registry | null | undefined): Block;
export function defaultTitle(block: Partial<Block> | null | undefined): string;
export function isDefaultTitle(block: Partial<Block> | null | undefined): boolean;
export function newBlockFor(kind: string, type: string, registry: Registry | null | undefined, blocks?: Block[]): Block;
export function withMarks(block: Block, value: unknown, optional?: boolean): Block;
export function splitListText(text: unknown, max?: number): string[];
export function countingList(count: unknown, gap?: unknown, max?: number): string[];
export function rowsWithPictures(field: FieldSpec, items: unknown, found: Array<{ picture: string; count?: number }>): { rows: Array<Record<string, unknown>>; dropped: number };
export function numberFromText(text: unknown, limits?: { min?: number; max?: number; integer?: boolean; optional?: boolean; fallback?: number }): { value: number | undefined; complete: boolean };
export function withItemKeys<T extends Partial<BlockDocument>>(document: T): T & { blocks: Block[] };
export function mergeSavedIds(local: BlockDocument, saved: Partial<BlockDocument> | null | undefined): BlockDocument;
export function documentMarks(document: Partial<BlockDocument> | null | undefined, registry: Registry | null | undefined): number;
export function moveBlock(blocks: Block[], index: number, delta: number): Block[];
export function duplicateBlock(block: Block): Block;
export function questionNumbers(blocks: Block[], registry: Registry | null | undefined): Array<number | null>;
export function blockSummary(block: Block, registry: Registry | null | undefined): string;
/** A matching question's pairs as text, from the bank form (left/right items linked by index) or the block form. */
export function matchingPairs(typeData: unknown): Array<{ left: string; right: string }>;
export function questionToItem(question: Record<string, any>): [string, Record<string, any>];
export function bankQuestionsToBlocks(questions: Array<Record<string, any>>): Block[];
export function isLostActivity(question: Record<string, any> | null | undefined): boolean;
export function bankAddedMessage(questions: Array<Record<string, any>>): string;
export function blockPictures(block: Block | null | undefined): PictureRef[];
export function scannedBlocksToBlocks(blocks: Block[]): Block[];
export function capturedPaperToBlocks(prefill: { blocks?: Block[]; structure?: unknown[]; questions?: unknown[] } | null | undefined): Block[];
export function problemsByQuestion(problems: string[]): Map<number, string[]>;

/** Structure step (docs/PAPER_BUILDER_STRUCTURE_PLAN.md). */
export interface StructureRow {
  key: string;
  /** The question this row stands for; none for a new row. */
  blockId?: string;
  type: string;
  marks: number;
  parts?: number;
  data?: Record<string, unknown>;
}
export interface StructureTemplate { id: string; label: string; rows: Array<Omit<StructureRow, 'key'>> }
export function structureLists(spec: BlockSpec | null | undefined): FieldSpec[];
export function structureFromBlocks(blocks: Block[] | null | undefined, registry: Registry | null | undefined): StructureRow[];
export function freshStructureRows(rows: Array<Partial<StructureRow>> | null | undefined): StructureRow[];
export function structureTotal(rows: Array<{ marks?: unknown }> | null | undefined): number;
export function stillToFill(block: Block | null | undefined, registry: Registry | null | undefined): boolean;
export function blockHasContent(block: Block | null | undefined, registry: Registry | null | undefined): boolean;
export function applyStructure(blocks: Block[] | null | undefined, rows: StructureRow[], registry: Registry | null | undefined, kind?: string): { blocks: Block[]; removed: Block[] };

/** Question type picker (server TYPE_GROUPS). */
export interface TypeGroup { id: string; label: string; early?: boolean }
export interface PickerSection { id: string; label: string; types: BlockSpec[] }
export function isEarlyClass(className: unknown): boolean;
export function pickerGroups(registry: Registry | null | undefined, options?: { early?: boolean; used?: string[]; search?: string; layout?: boolean }): PickerSection[];
