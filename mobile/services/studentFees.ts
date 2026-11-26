// Per-student fee amounts (overrides of the class charge), one or several categories at once; port of
// the web's StudentChargesGrid (frontend/src/pages/fee-collection/studentCharges.js). Pure logic, no
// React Native imports.
// Every override names its category, monthly too: an uncategorised monthly override used to replace
// all of the student's monthly overrides and was then charged on every monthly fee (2026-11-26).

import type { FeeKind, FeeStructure } from './feeStructure';

export interface FeeStudent { id: number; name: string; roll_number?: string | null }
export interface ChargeCategory { id: number; name: string; billing_mode?: string | null; default_amount?: number | string | null }

export interface StudentFeeCell {
  // Text in the box now; '' means "no amount".
  amount: string;
  // What the student is charged now: their own amount, else the class charge, else ''.
  original: string;
  classDefault: string;
  // The amount in force comes from an old override saved without a category (it applies to every
  // monthly fee); saving this box replaces it for this category only.
  legacy: boolean;
  edited: boolean;
}

export interface StudentFeeRow {
  studentId: number;
  name: string;
  roll: string;
  cells: Record<number, StudentFeeCell>;
}

export interface StudentFeeChange { studentId: number; name: string; roll: string; categoryId: number; amount: string; original: string }

// Typed amounts not saved yet: category id -> student id -> text.
export type StudentFeeEdits = Record<number, Record<number, string>>;

const amountText = (v: number | string | null | undefined) => (v == null || v === '' ? '' : String(Number(v)));
const categoryOf = (s: FeeStructure, kind: FeeKind) => (kind === 'MONTHLY' ? s.monthly_category : s.annual_category) ?? null;
const isEnrolledOnly = (c: ChargeCategory) => c.billing_mode === 'ENROLLED';
// The server's fallback for an uncategorised monthly row skips enrolled-only fees (generation_planner).
const usesLegacy = (kind: FeeKind, c: ChargeCategory) => kind === 'MONTHLY' && !isEnrolledOnly(c);
const live = (s: FeeStructure, kind: FeeKind) => s.is_active !== false && s.fee_type === kind;

// The class charge a student pays for one category unless they have their own amount.
export function classDefaultAmount(structures: FeeStructure[], classId: number, kind: FeeKind, category: ChargeCategory): string {
  const classRows = structures.filter((s) => !s.student && s.class_obj === classId && live(s, kind));
  const hit = classRows.find((s) => categoryOf(s, kind) === category.id)
    ?? (usesLegacy(kind, category) ? classRows.find((s) => categoryOf(s, kind) == null) : undefined);
  if (hit) return amountText(hit.monthly_amount);
  return isEnrolledOnly(category) ? amountText(category.default_amount) : '';
}

// Student overrides of one category: student id -> amount, plus whether it is an old uncategorised one.
export function overrideAmounts(structures: FeeStructure[], kind: FeeKind, category: ChargeCategory): Record<number, { amount: string; legacy: boolean }> {
  const out: Record<number, { amount: string; legacy: boolean }> = {};
  for (const s of structures) {
    if (!s.student || !live(s, kind) || categoryOf(s, kind) !== category.id) continue;
    if (out[s.student] === undefined) out[s.student] = { amount: amountText(s.monthly_amount), legacy: false };
  }
  if (usesLegacy(kind, category)) {
    for (const s of structures) {
      if (!s.student || !live(s, kind) || categoryOf(s, kind) != null) continue;
      if (out[s.student] === undefined) out[s.student] = { amount: amountText(s.monthly_amount), legacy: true };
    }
  }
  return out;
}

const rollOf = (s: FeeStudent) => parseInt(String(s.roll_number ?? ''), 10) || 9999;

export function buildStudentRows(
  students: FeeStudent[], structures: FeeStructure[], classId: number, kind: FeeKind, categories: ChargeCategory[], edits: StudentFeeEdits,
): StudentFeeRow[] {
  const perCategory = categories.map((c) => ({
    c, classDefault: classDefaultAmount(structures, classId, kind, c), overrides: overrideAmounts(structures, kind, c), edits: edits[c.id] ?? {},
  }));
  return [...students]
    .sort((a, b) => rollOf(a) - rollOf(b) || a.name.localeCompare(b.name))
    .map((s) => {
      const cells: Record<number, StudentFeeCell> = {};
      for (const p of perCategory) {
        const own = p.overrides[s.id];
        const original = own?.amount ?? p.classDefault;
        const edited = p.edits[s.id] !== undefined;
        cells[p.c.id] = { amount: edited ? p.edits[s.id] : original, original, classDefault: p.classDefault, legacy: !!own?.legacy, edited };
      }
      return { studentId: s.id, name: s.name, roll: s.roll_number ? String(s.roll_number) : '', cells };
    });
}

// Only boxes that were edited and now hold a different, non-empty amount are sent, so a save never
// touches the rest of the class.
export function changedCells(rows: StudentFeeRow[]): StudentFeeChange[] {
  const out: StudentFeeChange[] = [];
  for (const r of rows) {
    for (const [id, cell] of Object.entries(r.cells)) {
      const amount = cell.amount.trim();
      // An old uncategorised amount is saved even when kept as is: that moves it onto this fee.
      if (cell.edited && amount !== '' && (amount !== cell.original || cell.legacy)) {
        out.push({ studentId: r.studentId, name: r.name, roll: r.roll, categoryId: Number(id), amount, original: cell.original });
      }
    }
  }
  return out;
}

export const isOverride = (c: StudentFeeCell) => c.amount.trim() !== '' && c.amount.trim() !== c.classDefault;

// Sum of the student's amounts in the chosen categories.
export const rowTotal = (r: StudentFeeRow) =>
  Object.values(r.cells).reduce((sum, c) => sum + (Number.isFinite(Number(c.amount)) ? Number(c.amount) : 0), 0);

export function validateStudentFees(rows: StudentFeeRow[], effectiveFrom: string, categoryIds: number[]): string | null {
  if (categoryIds.length === 0) return 'Choose at least one fee.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) return 'Choose the date the new amounts start from.';
  const changed = changedCells(rows);
  if (changed.length === 0) return 'Change at least one student amount before saving.';
  const bad = [...new Set(changed.filter((c) => !Number.isFinite(Number(c.amount)) || Number(c.amount) < 0).map((c) => c.name))];
  if (bad.length) return `Enter a valid amount for ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ' and others' : ''}.`;
  return null;
}

export function buildStudentFeePayload(classId: number, kind: FeeKind, effectiveFrom: string, rows: StudentFeeRow[]) {
  const key = kind === 'ANNUAL' ? 'annual_category' : 'monthly_category';
  return {
    class_id: classId,
    fee_type: kind,
    effective_from: effectiveFrom,
    students: changedCells(rows).map((c) => ({ student_id: c.studentId, monthly_amount: c.amount, [key]: c.categoryId })),
  };
}

// "Tuition: 3 · Koder Kids: 1" — how many boxes change per category, in the order shown.
export function changeCountsText(changes: StudentFeeChange[], categories: ChargeCategory[]): string {
  return categories
    .map((c) => [c.name, changes.filter((x) => x.categoryId === c.id).length] as const)
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${name}: ${n}`)
    .join(' · ');
}

export function studentFeeSummary(className: string, rows: StudentFeeRow[], categories: ChargeCategory[], effectiveFrom: string): string {
  const changed = changedCells(rows);
  const names = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const lines = changed.slice(0, 6).map((c) => `${c.name} · ${names[c.categoryId] ?? 'Fee'}: ${c.original || 'none'} to ${Number(c.amount).toLocaleString()}`);
  if (changed.length > 6) lines.push(`and ${changed.length - 6} more`);
  return `${className}, from ${effectiveFrom}\n${changeCountsText(changed, categories)}\n${lines.join('\n')}`;
}
