// Pure logic for the fee structure editor; port of MonthlyChargesCardView / AnnualChargesCardView
// (frontend/src/pages/fee-collection). Charges are stored per MASTER class (FeeStructure.class_obj),
// even when the screen lists sections, exactly like the web (resolveClassIdToMasterClassId).
// The server replaces the class's current charge for each category it is sent, from the given date.

import type { ClassOption } from './attendanceEntry';

export type FeeKind = 'MONTHLY' | 'ANNUAL';

export interface FeeStructure {
  id: number;
  class_obj: number | null;
  student: number | null;
  fee_type: string;
  monthly_amount: number | string;
  monthly_category?: number | null;
  annual_category?: number | null;
  is_active: boolean;
}

export interface FeeCategory { id: number; name: string; description?: string; is_active?: boolean }

export interface ChargeRow {
  category: number | null;
  amount: string;
  // The amount currently saved for this category on the server, '' for a row the person added.
  saved: string;
}

const categoryOf = (s: FeeStructure, kind: FeeKind) => (kind === 'MONTHLY' ? s.monthly_category : s.annual_category) ?? null;

// The class-level charges now in force for a master class: active, not a per-student override.
export function savedRows(structures: FeeStructure[], classId: number, kind: FeeKind): ChargeRow[] {
  const seen = new Set<number>();
  const rows: ChargeRow[] = [];
  for (const s of structures) {
    const cat = categoryOf(s, kind);
    if (s.class_obj !== classId || s.student || s.fee_type !== kind || s.is_active === false || !cat || seen.has(cat)) continue;
    seen.add(cat);
    const amount = String(Number(s.monthly_amount));
    rows.push({ category: cat, amount, saved: amount });
  }
  return rows;
}

export const emptyRow = (): ChargeRow => ({ category: null, amount: '', saved: '' });

// Master classes that have a section this year, in section order (what the web lists:
// sessionScopedOnly). Falls back to every master class when the year has no sections.
export function feeClassOptions(sections: ClassOption[], masters: Array<{ id: number; name: string }>): Array<{ id: number; label: string }> {
  const sessionMasters = new Set(sections.filter((o) => o.isSession && o.classObj != null).map((o) => o.classObj as number));
  const pool = sessionMasters.size > 0 ? masters.filter((m) => sessionMasters.has(m.id)) : masters;
  return pool.map((m) => ({ id: m.id, label: m.name }));
}

const positive = (text: string) => text.trim() !== '' && Number(text) > 0 && Number.isFinite(Number(text));

// Rows the person added or changed; unchanged rows are not re-sent (the server would close and
// reopen them with a new effective date for nothing).
export function changedRows(rows: ChargeRow[]): ChargeRow[] {
  return rows.filter((r) => r.category && positive(r.amount) && (r.saved === '' || Number(r.amount) !== Number(r.saved)));
}

export function validateRows(rows: ChargeRow[], effectiveFrom: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) return 'Choose the date the new amounts start from.';
  const filled = rows.filter((r) => r.category || r.amount.trim());
  if (filled.some((r) => !r.category)) return 'Choose a category for every charge.';
  if (filled.some((r) => !positive(r.amount))) return 'Every charge needs an amount above zero.';
  const cats = filled.map((r) => r.category);
  if (new Set(cats).size !== cats.length) return 'A category appears twice.';
  if (changedRows(rows).length === 0) return 'Nothing has changed.';
  return null;
}

export function buildFeePayload(classId: number, kind: FeeKind, rows: ChargeRow[], effectiveFrom: string, academicYearId?: number | null) {
  return {
    structures: changedRows(rows).map((r) => ({
      class_obj: classId,
      fee_type: kind,
      ...(kind === 'MONTHLY' ? { monthly_category: r.category } : { annual_category: r.category }),
      monthly_amount: Number(r.amount),
    })),
    effective_from: effectiveFrom,
    ...(academicYearId ? { academic_year: academicYearId } : {}),
  };
}

export function totalOf(rows: ChargeRow[]): number {
  return rows.reduce((sum, r) => sum + (positive(r.amount) ? Number(r.amount) : 0), 0);
}

// Said before saving: what will change, so a wrong class or date is caught.
export function changeSummary(className: string, rows: ChargeRow[], effectiveFrom: string, names: Record<number, string>): string {
  const lines = changedRows(rows).map((r) => `${names[r.category as number] ?? 'Charge'}: ${r.saved ? `${Number(r.saved).toLocaleString()} → ` : 'new, '}${Number(r.amount).toLocaleString()}`);
  return `${className}, from ${effectiveFrom}\n${lines.join('\n')}`;
}
