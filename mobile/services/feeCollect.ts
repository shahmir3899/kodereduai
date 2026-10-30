// Pure logic for the Collect Payments screen; port of frontend/src/pages/fee-collection
// (feeUtils.js filterPayments, FeeCollectPage.jsx, FeeModals.jsx PaymentModal).

export type FeeStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'ADVANCE';
export type FeeTypeTab = 'MONTHLY' | 'ANNUAL' | 'ALL';

export interface FeePayment {
  id: number;
  student: number;
  student_name: string;
  student_roll?: string | number | null;
  class_name?: string;
  class_obj_id?: number | null;
  session_class_id?: number | null;
  session_class_label?: string | null;
  fee_type: string;
  fee_type_display?: string;
  annual_category_name?: string | null;
  monthly_category_name?: string | null;
  month: number;
  year: number;
  previous_balance?: number | string | null;
  amount_due: number | string;
  amount_paid: number | string;
  status: FeeStatus;
  payment_date?: string | null;
  payment_method?: string | null;
  receipt_number?: string | null;
  account?: number | null;
  account_name?: string | null;
  collected_by_name?: string | null;
}

export const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'ONLINE', label: 'Online Payment' },
  { value: 'OTHER', label: 'Other' },
] as const;

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

// What is still owed on a record. amount_due already includes any carry-forward balance.
export function balanceOf(p: Pick<FeePayment, 'amount_due' | 'amount_paid'>): number {
  return Math.max(0, num(p.amount_due) - num(p.amount_paid));
}

export function formatMoney(n: number): string {
  return `PKR ${Math.round(n).toLocaleString()}`;
}

export interface FeeFilters {
  masterClassId?: number | null;
  sessionClassId?: number | null;
  status?: string;
  search?: string;
}

// Fees are per section: match the section when both sides know it, so 5-A and 5-B never merge
// under their shared master class.
export function filterPayments(list: FeePayment[], f: FeeFilters): FeePayment[] {
  const q = (f.search || '').trim().toLowerCase();
  return list.filter((p) => {
    if (f.sessionClassId != null && p.session_class_id != null) {
      if (p.session_class_id !== f.sessionClassId) return false;
    } else if (f.masterClassId != null && p.class_obj_id != null) {
      if (p.class_obj_id !== f.masterClassId) return false;
    }
    if (f.status && p.status !== f.status) return false;
    if (q) {
      const hit = (p.student_name || '').toLowerCase().includes(q) || String(p.student_roll ?? '').toLowerCase().includes(q);
      if (!hit) return false;
    }
    return true;
  });
}

const TYPE_ORDER: Record<string, number> = { MONTHLY: 0, ANNUAL: 1, ADMISSION: 2, BOOKS: 3, FINE: 4 };

// By class, then roll, then student (keeping one student's fees together), monthly before annual.
export function sortPayments(list: FeePayment[]): FeePayment[] {
  return [...list].sort((a, b) => {
    const ca = (a.session_class_label || a.class_name || '').localeCompare(b.session_class_label || b.class_name || '');
    if (ca !== 0) return ca;
    const ra = parseInt(String(a.student_roll ?? ''), 10) || 0;
    const rb = parseInt(String(b.student_roll ?? ''), 10) || 0;
    if (ra !== rb) return ra - rb;
    if (a.student !== b.student) return (a.student_name || '').localeCompare(b.student_name || '');
    return (TYPE_ORDER[a.fee_type] ?? 9) - (TYPE_ORDER[b.fee_type] ?? 9);
  });
}

export function summarize(list: FeePayment[]) {
  let due = 0;
  let paid = 0;
  const count = { UNPAID: 0, PARTIAL: 0, PAID: 0, ADVANCE: 0 } as Record<FeeStatus, number>;
  for (const p of list) {
    due += num(p.amount_due);
    paid += num(p.amount_paid);
    count[p.status] = (count[p.status] ?? 0) + 1;
  }
  return { due, paid, pending: Math.max(0, due - paid), count };
}

// What a fee is called on a card: its category, else its type.
export function feeLabel(p: FeePayment): string {
  return p.monthly_category_name || p.annual_category_name || p.fee_type_display || p.fee_type;
}

// Only an unpaid or part-paid record takes a payment; an advance (overpaid) one is left alone.
export function canRecordPayment(p: Pick<FeePayment, 'status'>): boolean {
  return p.status === 'UNPAID' || p.status === 'PARTIAL';
}

export interface PaymentForm {
  amount: string;
  method: string;
  account: number | null;
  date: string;
  receipt: string;
  notes: string;
}

export function emptyPaymentForm(balance: number, today: string, defaultAccount: number | null = null): PaymentForm {
  return { amount: balance > 0 ? String(balance) : '', method: 'CASH', account: defaultAccount, date: today, receipt: '', notes: '' };
}

// null when fine. The amount is what is received now, so it can't be more than what is owed.
export function validatePayment(form: PaymentForm, balance: number, today: string): string | null {
  const t = form.amount.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t) || Number(t) <= 0) return 'Enter the amount received';
  if (Number(t) > balance) return `Amount is more than the balance (${formatMoney(balance)})`;
  if (!form.account) return 'Please select an account';
  if (!form.date) return 'Please pick the payment date';
  if (form.date > today) return 'The payment date cannot be in the future';
  return null;
}

// The API stores the TOTAL received on the record (amount_paid), not the new instalment. So the
// request carries what was already paid plus what is received now.
export function buildPaymentPatch(p: Pick<FeePayment, 'amount_paid'>, form: PaymentForm) {
  const total = Math.round((num(p.amount_paid) + Number(form.amount)) * 100) / 100;
  return {
    amount_paid: total,
    payment_method: form.method,
    account: form.account,
    payment_date: form.date,
    receipt_number: form.receipt.trim(),
    notes: form.notes.trim(),
  };
}

export function statusTone(s: FeeStatus): 'success' | 'warning' | 'error' | 'info' {
  return s === 'PAID' ? 'success' : s === 'PARTIAL' ? 'warning' : s === 'ADVANCE' ? 'info' : 'error';
}

// One year-month step, never past the current month (fees for the future don't exist yet).
export function stepFeeMonth(
  year: number, month: number, delta: number, current: { year: number; month: number },
): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  const next = { year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 };
  return next.year * 12 + next.month > current.year * 12 + current.month ? { ...current } : next;
}
