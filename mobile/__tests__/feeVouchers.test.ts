import { voucherFileName, voucherParams } from '../services/feeVouchers';
import type { FeePayment } from '../services/feeCollect';

const row = (id: number, student: number) => ({ id, student, student_name: `S${student}`, fee_type: 'MONTHLY', month: 11, year: 2026, amount_due: 100, amount_paid: 0, status: 'UNPAID' }) as FeePayment;
const shown = [row(1, 10), row(2, 10), row(3, 11), row(4, 12)];
const base = { month: 11, year: 2026, shown, selectedIds: [] as number[], filtered: false, option: null, academicYearId: 5 };

describe('voucherParams', () => {
  it('sends chosen rows as unique student ids', () => {
    expect(voucherParams({ ...base, selectedIds: [1, 2, 4] })).toEqual({ month: 11, year: 2026, only_unpaid: 1, academic_year: 5, student_ids: '10,12' });
  });

  it('sends what is on screen when a filter is on', () => {
    expect(voucherParams({ ...base, filtered: true }).student_ids).toBe('10,11,12');
  });

  it('sends a section scope instead of ids for a whole class', () => {
    const p = voucherParams({ ...base, option: { id: 7, label: '5-A', classObj: 3, isSession: true } });
    expect(p.session_class_id).toBe(7);
    expect(p.student_ids).toBeUndefined();
    expect(voucherParams({ ...base, option: { id: 3, label: '5', classObj: null, isSession: false } }).class_id).toBe(3);
  });

  it('whole school: no scope at all', () => {
    expect(voucherParams(base)).toEqual({ month: 11, year: 2026, only_unpaid: 1, academic_year: 5 });
  });

  it('names the file by month', () => {
    expect(voucherFileName(3, 2026)).toBe('fee-vouchers-2026-03.pdf');
  });
});
