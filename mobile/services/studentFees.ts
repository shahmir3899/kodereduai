// Per-student fee amounts (overrides of the class charge); port of the student mode of the web's
// MonthlyChargesTab and AnnualChargesStudentTab. Pure logic, no React Native imports.
// A monthly override has no category (the server replaces every monthly override of the student);
// an annual one needs its annual category.

import type { FeeKind, FeeStructure } from './feeStructure';

export interface FeeStudent { id: number; name: string; roll_number?: string | null }

export interface StudentFeeRow {
  studentId: number;
  name: string;
  roll: string;
  // Text in the box now; '' means "no amount".
  amount: string;
  // What is saved for the student now: their own override, else the class charge, else ''.
  original: string;
  classDefault: string;
  edited: boolean;
}

const amountText = (v: number | string | null | undefined) => (v == null || v === '' ? '' : String(Number(v)));

const inScope = (s: FeeStructure, classId: number, kind: FeeKind, categoryId: number | null) =>
  s.is_active !== false && s.fee_type === kind && s.class_obj === classId &&
  (kind === 'MONTHLY' || (s.annual_category ?? null) === categoryId);

// The class charge a student pays unless they have their own amount.
export function classDefaultAmount(structures: FeeStructure[], classId: number, kind: FeeKind, categoryId: number | null): string {
  const hit = structures.find((s) => !s.student && inScope(s, classId, kind, categoryId));
  return hit ? amountText(hit.monthly_amount) : '';
}

// Student overrides: the structure rows of this class's kind and category that belong to one student.
// A student carries no class_obj on the override, so the scope here is the kind and category only.
export function overrideAmounts(structures: FeeStructure[], kind: FeeKind, categoryId: number | null): Record<number, string> {
  const out: Record<number, string> = {};
  for (const s of structures) {
    if (!s.student || s.is_active === false || s.fee_type !== kind) continue;
    if (kind === 'ANNUAL' && (s.annual_category ?? null) !== categoryId) continue;
    if (out[s.student] === undefined) out[s.student] = amountText(s.monthly_amount);
  }
  return out;
}

const rollOf = (s: FeeStudent) => parseInt(String(s.roll_number ?? ''), 10) || 9999;

export function buildStudentRows(
  students: FeeStudent[], structures: FeeStructure[], classId: number, kind: FeeKind, categoryId: number | null, edits: Record<number, string>,
): StudentFeeRow[] {
  const classDefault = classDefaultAmount(structures, classId, kind, categoryId);
  const overrides = overrideAmounts(structures, kind, categoryId);
  return [...students]
    .sort((a, b) => rollOf(a) - rollOf(b) || a.name.localeCompare(b.name))
    .map((s) => {
      const original = overrides[s.id] ?? classDefault;
      const edited = edits[s.id] !== undefined;
      return {
        studentId: s.id, name: s.name, roll: s.roll_number ? String(s.roll_number) : '',
        amount: edited ? edits[s.id] : original, original, classDefault, edited,
      };
    });
}

// Only students whose box was edited and now holds a different, non-empty amount are sent, so a
// save never touches the rest of the class.
export function changedStudentRows(rows: StudentFeeRow[]): StudentFeeRow[] {
  return rows.filter((r) => r.edited && r.amount.trim() !== '' && r.amount.trim() !== r.original);
}

export const isOverride = (r: StudentFeeRow) => r.amount.trim() !== '' && r.amount.trim() !== r.classDefault;

export function validateStudentFees(rows: StudentFeeRow[], effectiveFrom: string, kind: FeeKind, categoryId: number | null): string | null {
  if (kind === 'ANNUAL' && !categoryId) return 'Choose the annual category.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) return 'Choose the date the new amounts start from.';
  const changed = changedStudentRows(rows);
  if (changed.length === 0) return 'Change at least one student amount before saving.';
  const bad = changed.filter((r) => !Number.isFinite(Number(r.amount)) || Number(r.amount) < 0);
  if (bad.length) return `Enter a valid amount for ${bad.slice(0, 3).map((r) => r.name).join(', ')}${bad.length > 3 ? ' and others' : ''}.`;
  return null;
}

export function buildStudentFeePayload(classId: number, kind: FeeKind, categoryId: number | null, effectiveFrom: string, rows: StudentFeeRow[]) {
  return {
    class_id: classId,
    fee_type: kind,
    effective_from: effectiveFrom,
    students: changedStudentRows(rows).map((r) => ({
      student_id: r.studentId,
      monthly_amount: r.amount.trim(),
      ...(kind === 'ANNUAL' ? { annual_category: categoryId } : {}),
    })),
  };
}

export function studentFeeSummary(className: string, rows: StudentFeeRow[], effectiveFrom: string): string {
  const changed = changedStudentRows(rows);
  const lines = changed.slice(0, 6).map((r) => `${r.name}: ${r.original || 'none'} to ${Number(r.amount).toLocaleString()}`);
  if (changed.length > 6) lines.push(`and ${changed.length - 6} more`);
  return `${className}, from ${effectiveFrom}\n${lines.join('\n')}`;
}
