import type { ClassOption } from './attendanceEntry';
import type { FeePayment } from './feeCollect';

// Which students a voucher PDF covers, mirroring the web: chosen rows first, else the rows a
// search/status/category filter left on screen, else the whole class (or school) as a scope so a
// big list never becomes a huge URL.
export function voucherParams(opts: {
  month: number;
  year: number;
  shown: FeePayment[];
  selectedIds: number[];
  filtered: boolean;
  option: ClassOption | null;
  academicYearId?: number | null;
}): Record<string, string | number> {
  const params: Record<string, string | number> = { month: opts.month, year: opts.year, only_unpaid: 1 };
  if (opts.academicYearId) params.academic_year = opts.academicYearId;
  const studentsOf = (rows: FeePayment[]) => [...new Set(rows.map((p) => p.student).filter(Boolean))];
  if (opts.selectedIds.length > 0) {
    params.student_ids = studentsOf(opts.shown.filter((p) => opts.selectedIds.includes(p.id))).join(',');
  } else if (opts.filtered) {
    params.student_ids = studentsOf(opts.shown).join(',');
  } else if (opts.option) {
    if (opts.option.isSession) params.session_class_id = opts.option.id;
    else params.class_id = opts.option.id;
  }
  return params;
}

export function voucherFileName(month: number, year: number): string {
  return `fee-vouchers-${year}-${String(month).padStart(2, '0')}.pdf`;
}

const pad = (n: number) => String(n).padStart(2, '0');

// The school's due day in the voucher month; once that day has passed (printing late), a week from
// today instead, so a parent is never handed a voucher that is already overdue. Same rule as the web.
export function defaultDueDate(year: number, month: number, dueDay: number | null | undefined, today: string) {
  const usual = `${year}-${pad(month)}-${pad(Math.min(Number(dueDay) || 10, 28))}`;
  if (usual >= today) return { date: usual, late: false, usual };
  const t = new Date(`${today}T00:00:00`);
  t.setDate(t.getDate() + 7);
  return { date: `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`, late: true, usual };
}

export interface VoucherPreview {
  count: number;
  school_name: string;
  note: string;
  bank: { bank_name: string; account_number: string } | null;
  vouchers: Array<{
    student_id: number; student_name: string; class_label: string; voucher_number: string; due_date: string;
    kuickpay_number: string; lines: Array<{ label: string; amount: string }>;
    current_total: string; discount: string; previous_unpaid: string; paid: string; total_payable: string;
  }>;
}
