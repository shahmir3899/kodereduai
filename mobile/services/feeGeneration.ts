// Pure logic for generating fee records (bulk and single); port of FeeGenerationSurface.jsx,
// CreateSingleFeeModal and the rules in backend/finance (GenerateMonthly/Annual/SingleFee
// serializers, generation_planner). Admin and principal only. These create real fee rows for
// students, so every bulk run is previewed first and confirmed with the numbers.

import type { ClassOption } from './attendanceEntry';

export type GenKind = 'MONTHLY' | 'ANNUAL';
export type Conflict = 'skip' | 'update' | 'delete_recreate';

export const CONFLICTS: Array<{ value: Conflict; label: string; hint: string }> = [
  { value: 'skip', label: 'Keep existing records', hint: 'Only students with no record yet get one.' },
  { value: 'update', label: 'Update existing records', hint: 'Changes the amount on unpaid records to the new amount.' },
  { value: 'delete_recreate', label: 'Delete and recreate', hint: 'Removes unpaid records and makes them again. Paid records are never touched.' },
];

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface Preview {
  will_create: number;
  already_exist: number;
  no_fee_structure: number;
  total_amount: string;
  has_more?: boolean;
  students?: Array<Record<string, unknown>>;
}

export interface BulkForm {
  kind: GenKind;
  month: number;
  year: number;
  classOption: number | null; // null = every class
  categories: number[];
  conflict: Conflict;
}

export const emptyBulkForm = (now = new Date()): BulkForm => ({
  kind: 'MONTHLY', month: now.getMonth() + 1, year: now.getFullYear(), classOption: null, categories: [], conflict: 'skip',
});

export const yearOptions = (now = new Date()) => [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1, now.getFullYear() + 2];

// A section wins over its master class, as on the server; never send both.
function scope(option: ClassOption | undefined) {
  if (!option) return {};
  return option.isSession ? { session_class_id: option.id } : { class_id: option.id };
}

// Query for the read-only preview. Annual records have month 0.
export function previewParams(f: BulkForm, option: ClassOption | undefined, academicYearId?: number | null) {
  return {
    fee_type: f.kind,
    year: f.year,
    month: f.kind === 'MONTHLY' ? f.month : 0,
    ...scope(option),
    ...(academicYearId ? { academic_year: academicYearId } : {}),
    ...(f.kind === 'MONTHLY' ? { monthly_categories: f.categories.join(',') } : { annual_categories: f.categories.join(',') }),
  };
}

export function validateBulk(f: BulkForm, preview: Preview | undefined): string | null {
  if (f.categories.length === 0) return f.kind === 'MONTHLY' ? 'Choose at least one monthly category.' : 'Choose at least one annual category.';
  if (!preview) return 'Wait for the preview.';
  if (preview.will_create <= 0 && preview.already_exist <= 0) return 'There are no records to generate for this selection.';
  return null;
}

export function buildBulkPayload(f: BulkForm, option: ClassOption | undefined, academicYearId?: number | null) {
  return {
    year: f.year,
    ...(f.kind === 'MONTHLY' ? { month: f.month, monthly_category_ids: f.categories } : { annual_category_ids: f.categories }),
    ...scope(option),
    ...(academicYearId ? { academic_year: academicYearId } : {}),
    conflict_strategy: f.conflict,
  };
}

export function previewText(p: Preview): string {
  const parts = [
    `${p.will_create} new record${p.will_create === 1 ? '' : 's'}`,
    p.already_exist > 0 ? `${p.already_exist} already exist` : '',
    p.no_fee_structure > 0 ? `${p.no_fee_structure} student${p.no_fee_structure === 1 ? ' has' : 's have'} no fee set` : '',
  ].filter(Boolean);
  const total = Number(p.total_amount);
  return `${parts.join(', ')}${total > 0 ? `. Total PKR ${Math.round(total).toLocaleString()}.` : '.'}`;
}

export function confirmText(f: BulkForm, className: string, p: Preview): string {
  const when = f.kind === 'MONTHLY' ? `${MONTH_NAMES[f.month - 1]} ${f.year}` : `${f.year}`;
  return `${f.kind === 'MONTHLY' ? 'Monthly' : 'Annual'} fees for ${className || 'every class'}, ${when}.\n${previewText(p)}\n${CONFLICTS.find((c) => c.value === f.conflict)?.label}.`;
}

// Port of formatGenerationResult: the server answers 200 with the counts when it ran at once, or
// 202 when it went to a background task.
export function resultText(status: number, data: { message?: string; result?: Record<string, number> } | undefined): string {
  const r = data?.result;
  if (status === 202 || r?.created == null) return data?.message ?? 'Fee generation started. It finishes in the background.';
  return [
    `Created ${r.created} records.`,
    (r.updated ?? 0) > 0 ? `Updated ${r.updated}.` : '',
    (r.deleted_recreated ?? 0) > 0 ? `Recreated ${r.deleted_recreated}.` : '',
    (r.skipped ?? 0) > 0 ? `Skipped ${r.skipped}.` : '',
    (r.protected_conflict ?? 0) > 0 ? `${r.protected_conflict} protected record${r.protected_conflict === 1 ? '' : 's'} left unchanged.` : '',
    (r.no_fee_structure ?? 0) > 0 ? `${r.no_fee_structure} students have no fee set.` : '',
  ].filter(Boolean).join(' ');
}

// ─── Single record ─────────────────────────────────────────────────────────────────────────

export interface SingleForm {
  student: number | null;
  kind: GenKind;
  month: number;
  year: number;
  category: number | null;
  conflict: Conflict;
}

export const emptySingleForm = (now = new Date()): SingleForm => ({
  student: null, kind: 'MONTHLY', month: now.getMonth() + 1, year: now.getFullYear(), category: null, conflict: 'skip',
});

export function validateSingle(f: SingleForm): string | null {
  if (!f.student) return 'Choose the student.';
  if (!f.category) return f.kind === 'MONTHLY' ? 'Choose the monthly category.' : 'Choose the annual category.';
  if (f.year < 2020 || f.year > 2100) return 'Choose a year.';
  return null;
}

// The server wants the matching category field only: monthly with a month, annual with month 0.
export function buildSinglePayload(f: SingleForm, academicYearId?: number | null) {
  return {
    student: f.student,
    fee_type: f.kind,
    year: f.year,
    month: f.kind === 'MONTHLY' ? f.month : 0,
    ...(f.kind === 'MONTHLY' ? { monthly_category: f.category } : { annual_category: f.category }),
    ...(academicYearId ? { academic_year: academicYearId } : {}),
    conflict_strategy: f.conflict,
  };
}
