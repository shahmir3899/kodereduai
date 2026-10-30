// Pure logic for Discounts, Scholarships and their student assignments; port of
// frontend/src/pages/finance/DiscountsPage.jsx and the rules in backend/finance/serializers.py.
// Admin and principal only (IsSchoolAdmin on the server). The server re-checks everything.

import type { ClassOption } from './attendanceEntry';

const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

export const DISCOUNT_TYPES = [{ value: 'PERCENTAGE', label: 'Percentage' }, { value: 'FIXED', label: 'Fixed amount' }] as const;
export const APPLIES_TO = [
  { value: 'ALL', label: 'All students' },
  { value: 'GRADE_LEVEL', label: 'All classes at a grade level' },
  { value: 'CLASS', label: 'A specific class' },
  { value: 'STUDENT', label: 'Individual students' },
  { value: 'SIBLING', label: 'Siblings (automatic)' },
] as const;
export const SCHOLARSHIP_TYPES = [
  { value: 'MERIT', label: 'Merit' }, { value: 'NEED', label: 'Need-based' }, { value: 'SPORTS', label: 'Sports' },
  { value: 'STAFF_CHILD', label: 'Staff child' }, { value: 'OTHER', label: 'Other' },
] as const;
export const COVERAGES = [
  { value: 'FULL', label: 'Full fee waiver' }, { value: 'PERCENTAGE', label: 'Percentage off' }, { value: 'FIXED', label: 'Fixed amount off' },
] as const;

export interface Discount {
  id: number;
  name: string;
  discount_type: string;
  value: number | string;
  applies_to: string;
  applies_to_display?: string;
  target_grade_level?: number | null;
  target_class?: number | null;
  target_class_name?: string | null;
  academic_year?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  is_active: boolean;
  max_uses?: number | null;
  stackable?: boolean;
  usage_count?: number;
}

export interface Scholarship {
  id: number;
  name: string;
  description?: string;
  scholarship_type: string;
  scholarship_type_display?: string;
  coverage: string;
  value: number | string;
  max_recipients?: number | null;
  is_active: boolean;
  recipient_count?: number;
  academic_year?: number | null;
}

export interface StudentDiscount {
  id: number;
  student: number;
  student_name: string;
  student_roll?: string | number | null;
  class_name?: string | null;
  discount?: number | null;
  discount_name?: string | null;
  scholarship?: number | null;
  scholarship_name?: string | null;
  academic_year_name?: string | null;
  is_active: boolean;
  notes?: string;
}

// ─── Wording ───────────────────────────────────────────────────────────────────────────────

const money = (n: number) => `PKR ${Math.round(n).toLocaleString()}`;

export function discountValueText(d: Pick<Discount, 'discount_type' | 'value'>): string {
  return d.discount_type === 'PERCENTAGE' ? `${num(d.value)}% off` : `${money(num(d.value))} off`;
}

export function scholarshipValueText(s: Pick<Scholarship, 'coverage' | 'value'>): string {
  if (s.coverage === 'FULL') return 'Full waiver';
  return s.coverage === 'PERCENTAGE' ? `${num(s.value)}% off` : `${money(num(s.value))} off`;
}

export function discountScopeText(d: Discount): string {
  if (d.applies_to === 'GRADE_LEVEL') return `Grade ${d.target_grade_level ?? '?'}`;
  if (d.applies_to === 'CLASS') return d.target_class_name || 'One class';
  return d.applies_to_display || APPLIES_TO.find((a) => a.value === d.applies_to)?.label || d.applies_to;
}

// Amount a discount takes off a base fee, rounded to paisa; mirrors calcDiscountOff on the web.
export function amountOff(kind: { type: 'discount'; d: Pick<Discount, 'discount_type' | 'value'> } | { type: 'scholarship'; s: Pick<Scholarship, 'coverage' | 'value'> }, base: number): number {
  if (!(base > 0)) return 0;
  const pct = (p: number) => Math.round(((base * p) / 100) * 100) / 100;
  if (kind.type === 'discount') return kind.d.discount_type === 'PERCENTAGE' ? pct(num(kind.d.value)) : Math.min(num(kind.d.value), base);
  if (kind.s.coverage === 'FULL') return base;
  return kind.s.coverage === 'PERCENTAGE' ? pct(num(kind.s.value)) : Math.min(num(kind.s.value), base);
}

// ─── Discount form ─────────────────────────────────────────────────────────────────────────

export interface DiscountForm {
  name: string;
  type: string;
  value: string;
  appliesTo: string;
  gradeLevel: string;
  targetClass: number | null;
  startDate: string;
  endDate: string;
  maxUses: string;
  stackable: boolean;
  isActive: boolean;
}

export const emptyDiscountForm = (): DiscountForm => ({
  name: '', type: 'PERCENTAGE', value: '', appliesTo: 'ALL', gradeLevel: '', targetClass: null,
  startDate: '', endDate: '', maxUses: '', stackable: false, isActive: true,
});

export const discountToForm = (d: Discount): DiscountForm => ({
  name: d.name, type: d.discount_type, value: String(num(d.value)), appliesTo: d.applies_to,
  gradeLevel: d.target_grade_level != null ? String(d.target_grade_level) : '', targetClass: d.target_class ?? null,
  startDate: d.start_date ?? '', endDate: d.end_date ?? '', maxUses: d.max_uses != null ? String(d.max_uses) : '',
  stackable: !!d.stackable, isActive: d.is_active,
});

export function validateDiscount(f: DiscountForm): string | null {
  if (!f.name.trim()) return 'Enter a name.';
  if (f.value.trim() === '' || !(Number(f.value) >= 0)) return 'Enter the value as a number, zero or more.';
  if (f.type === 'PERCENTAGE' && Number(f.value) > 100) return 'A percentage must be between 0 and 100.';
  if (f.appliesTo === 'GRADE_LEVEL' && !/^\d+$/.test(f.gradeLevel.trim())) return 'Enter the grade level as a number.';
  if (f.appliesTo === 'CLASS' && !f.targetClass) return 'Choose the class.';
  if (f.startDate && f.endDate && f.endDate < f.startDate) return 'The end date is before the start date.';
  if (f.maxUses.trim() && !/^\d+$/.test(f.maxUses.trim())) return 'Maximum uses must be a whole number.';
  return null;
}

export function buildDiscountPayload(f: DiscountForm, academicYearId?: number | null) {
  return {
    name: f.name.trim(),
    discount_type: f.type,
    value: Number(f.value),
    applies_to: f.appliesTo,
    target_grade_level: f.appliesTo === 'GRADE_LEVEL' ? Number(f.gradeLevel) : null,
    target_class: f.appliesTo === 'CLASS' ? f.targetClass : null,
    start_date: f.startDate || null,
    end_date: f.endDate || null,
    max_uses: f.maxUses.trim() ? Number(f.maxUses) : null,
    stackable: f.stackable,
    is_active: f.isActive,
    ...(academicYearId ? { academic_year: academicYearId } : {}),
  };
}

// ─── Scholarship form ──────────────────────────────────────────────────────────────────────

export interface ScholarshipForm {
  name: string;
  description: string;
  type: string;
  coverage: string;
  value: string;
  maxRecipients: string;
  isActive: boolean;
}

export const emptyScholarshipForm = (): ScholarshipForm => ({
  name: '', description: '', type: 'MERIT', coverage: 'FULL', value: '', maxRecipients: '', isActive: true,
});

export const scholarshipToForm = (s: Scholarship): ScholarshipForm => ({
  name: s.name, description: s.description ?? '', type: s.scholarship_type, coverage: s.coverage,
  value: s.coverage === 'FULL' ? '' : String(num(s.value)), maxRecipients: s.max_recipients != null ? String(s.max_recipients) : '', isActive: s.is_active,
});

export function validateScholarship(f: ScholarshipForm): string | null {
  if (!f.name.trim()) return 'Enter a name.';
  if (f.coverage !== 'FULL') {
    if (f.value.trim() === '' || !(Number(f.value) >= 0)) return 'Enter the value as a number, zero or more.';
    if (f.coverage === 'PERCENTAGE' && Number(f.value) > 100) return 'A percentage must be between 0 and 100.';
  }
  if (f.maxRecipients.trim() && !/^\d+$/.test(f.maxRecipients.trim())) return 'Maximum recipients must be a whole number.';
  return null;
}

export function buildScholarshipPayload(f: ScholarshipForm, academicYearId?: number | null) {
  return {
    name: f.name.trim(),
    description: f.description.trim(),
    scholarship_type: f.type,
    coverage: f.coverage,
    // A full waiver has no amount; the column still needs a number.
    value: f.coverage === 'FULL' ? 0 : Number(f.value),
    max_recipients: f.maxRecipients.trim() ? Number(f.maxRecipients) : null,
    is_active: f.isActive,
    ...(academicYearId ? { academic_year: academicYearId } : {}),
  };
}

// ─── Assignments ───────────────────────────────────────────────────────────────────────────

export type AssignKind = 'discount' | 'scholarship';

export interface AssignForm {
  kind: AssignKind;
  student: number | null;
  discount: number | null;
  scholarship: number | null;
  notes: string;
}

export const emptyAssignForm = (): AssignForm => ({ kind: 'discount', student: null, discount: null, scholarship: null, notes: '' });

export function validateAssign(f: AssignForm, academicYearId: number | null | undefined): string | null {
  if (!academicYearId) return 'There is no active academic year.';
  if (!f.student) return 'Choose a student.';
  if (f.kind === 'discount' && !f.discount) return 'Choose a discount.';
  if (f.kind === 'scholarship' && !f.scholarship) return 'Choose a scholarship.';
  return null;
}

export function buildAssignPayload(f: AssignForm, academicYearId: number) {
  return {
    student_id: f.student,
    discount_id: f.kind === 'discount' ? f.discount : null,
    scholarship_id: f.kind === 'scholarship' ? f.scholarship : null,
    academic_year_id: academicYearId,
    notes: f.notes.trim(),
  };
}

// A section (SessionClass) wins over its master class, as on the server; never send both.
export function buildBulkPayload(kind: AssignKind, id: number | null, option: ClassOption | null, academicYearId: number | null | undefined) {
  if (!academicYearId) return { error: 'There is no active academic year.' as const };
  if (!id) return { error: (kind === 'discount' ? 'Choose a discount.' : 'Choose a scholarship.') as string };
  if (!option) return { error: 'Choose a class.' as const };
  return {
    payload: {
      ...(kind === 'discount' ? { discount_id: id } : { scholarship_id: id }),
      ...(option.isSession ? { session_class_id: option.id } : { class_id: option.id }),
      academic_year_id: academicYearId,
    },
  };
}

export function bulkResultText(r: { created?: number; skipped?: number; total_students?: number }): string {
  const created = r.created ?? 0;
  const skipped = r.skipped ?? 0;
  if (created === 0 && skipped > 0) return `Everyone in the class already has it (${skipped} students).`;
  if ((r.total_students ?? 0) === 0) return 'No students found in that class.';
  return `Assigned to ${created} student${created === 1 ? '' : 's'}${skipped ? `, ${skipped} already had it` : ''}.`;
}
