// Pure logic for Payroll (payslips) and Salary structures; port of frontend/src/pages/hr
// (PayrollPage.jsx, SalaryManagementPage.jsx) and backend/hr. Admin and principal only
// (HR_WRITE_ROLES); every other role reads only its own payslips (see services/accountant.ts).

import type { Payslip } from './accountant';

const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

export interface PayslipFull extends Payslip {
  staff_member: number;
  staff_member_name: string;
  staff_employee_id?: string | null;
  department_name?: string | null;
  allowances_breakdown?: Record<string, number | string>;
  deductions_breakdown?: Record<string, number | string>;
  total_allowances?: number | string;
  notes?: string;
}

export interface PayrollSummary {
  month: number;
  year: number;
  total_payslips: number;
  total_basic: string;
  total_allowances: string;
  total_deductions: string;
  total_net: string;
  draft_count: number;
  approved_count: number;
  paid_count: number;
}

export type PayslipStatus = 'DRAFT' | 'APPROVED' | 'PAID';

export const STATUS_FILTERS: Array<{ value: '' | PayslipStatus; label: string }> = [
  { value: '', label: 'All' }, { value: 'DRAFT', label: 'Draft' }, { value: 'APPROVED', label: 'Approved' }, { value: 'PAID', label: 'Paid' },
];

// What may be done to a payslip in each state, as the server allows it (views: approve needs DRAFT,
// mark_paid needs DRAFT or APPROVED, only a DRAFT can be deleted).
export function payslipActions(status: string): { approve: boolean; markPaid: boolean; remove: boolean } {
  return { approve: status === 'DRAFT', markPaid: status === 'DRAFT' || status === 'APPROVED', remove: status === 'DRAFT' };
}

export function breakdownLines(b: Record<string, number | string> | null | undefined): Array<{ label: string; amount: number }> {
  return Object.entries(b ?? {})
    .map(([key, value]) => ({ label: key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), amount: num(value) }))
    .filter((l) => l.amount !== 0);
}

export function summaryLine(s: PayrollSummary): string {
  return `${s.total_payslips} payslip${s.total_payslips === 1 ? '' : 's'} · ${s.draft_count} draft · ${s.approved_count} approved · ${s.paid_count} paid`;
}

// Generation wording: the server answers 200 with a result when it finished at once, or 202 when it
// went to a background task (more than 50 active staff).
export function generationText(status: number, data: { message?: string; result?: { created?: number; skipped?: number } } | undefined): string {
  if (status === 202) return data?.message ?? 'Payslip generation started. Refresh in a minute.';
  const r = data?.result;
  if (r && (r.created != null || r.skipped != null)) {
    return `${r.created ?? 0} payslip${r.created === 1 ? '' : 's'} created${r.skipped ? `, ${r.skipped} skipped` : ''}.`;
  }
  return data?.message ?? 'Payslips generated.';
}

export function payslipFileName(p: Pick<Payslip, 'month' | 'year'>, who: string): string {
  const name = (who || 'Staff').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Staff';
  return `Payslip_${name}_${p.year}-${String(p.month).padStart(2, '0')}.pdf`;
}

// ─── Salary structure ──────────────────────────────────────────────────────────────────────

export interface SalaryStructure {
  id: number;
  staff_member: number;
  staff_member_name: string;
  staff_employee_id?: string | null;
  department_name?: string | null;
  basic_salary: number | string;
  allowances: Record<string, number | string>;
  deductions: Record<string, number | string>;
  gross_salary?: number | string;
  total_deductions?: number | string;
  net_salary?: number | string;
  effective_from: string;
  effective_to?: string | null;
  is_active: boolean;
}

export interface PairRow { key: string; amount: string }

export const pairsFromDict = (d: Record<string, number | string> | null | undefined): PairRow[] =>
  Object.entries(d ?? {}).map(([key, value]) => ({ key, amount: String(num(value)) }));

// Rows with a name and an amount; a blank row is ignored.
export function dictFromPairs(rows: PairRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const key = r.key.trim().toLowerCase().replace(/\s+/g, '_');
    if (key && r.amount.trim() !== '') out[key] = Number(r.amount);
  }
  return out;
}

export const pairsTotal = (rows: PairRow[]) => rows.reduce((s, r) => s + (r.key.trim() && Number(r.amount) > 0 ? Number(r.amount) : 0), 0);

export interface SalaryForm {
  staff: number | null;
  basic: string;
  allowances: PairRow[];
  deductions: PairRow[];
  effectiveFrom: string;
  isActive: boolean;
}

export const emptySalaryForm = (today: string): SalaryForm => ({ staff: null, basic: '', allowances: [], deductions: [], effectiveFrom: today, isActive: true });

export const salaryToForm = (s: SalaryStructure): SalaryForm => ({
  staff: s.staff_member, basic: String(num(s.basic_salary)), allowances: pairsFromDict(s.allowances), deductions: pairsFromDict(s.deductions),
  effectiveFrom: s.effective_from, isActive: s.is_active,
});

export function validateSalary(f: SalaryForm, creating: boolean): string | null {
  if (creating && !f.staff) return 'Choose the staff member.';
  if (f.basic.trim() === '' || !(Number(f.basic) >= 0)) return 'Enter the basic salary as a number, zero or more.';
  for (const group of [f.allowances, f.deductions]) {
    for (const r of group) {
      if (r.key.trim() && !(r.amount.trim() !== '' && Number(r.amount) >= 0)) return `Enter an amount for "${r.key.trim()}".`;
      if (!r.key.trim() && r.amount.trim()) return 'Give every amount a name.';
    }
    const keys = group.map((r) => r.key.trim().toLowerCase()).filter(Boolean);
    if (new Set(keys).size !== keys.length) return 'A name appears twice in the same list.';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.effectiveFrom)) return 'Choose the date it starts from.';
  return null;
}

export function buildSalaryPayload(f: SalaryForm, creating: boolean) {
  return {
    ...(creating ? { staff_member: f.staff } : {}),
    basic_salary: Number(f.basic),
    allowances: dictFromPairs(f.allowances),
    deductions: dictFromPairs(f.deductions),
    effective_from: f.effectiveFrom,
    is_active: f.isActive,
  };
}

// Same arithmetic as the web preview: gross = basic + allowances, net = gross - deductions.
export function salaryPreview(f: Pick<SalaryForm, 'basic' | 'allowances' | 'deductions'>) {
  const basic = num(f.basic);
  const gross = basic + pairsTotal(f.allowances);
  const deductions = pairsTotal(f.deductions);
  return { gross, deductions, net: gross - deductions };
}
