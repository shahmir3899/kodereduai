import { groupByStudent, groupStatus, shouldGroupByStudent, type FeePayment } from '../services/feeCollect';
import { perFeeLines, type Preview } from '../services/feeGeneration';
import { defaultDueDate } from '../services/feeVouchers';

const fee = (id: number, student: number, name: string, cat: string, due: number, paid = 0, status = 'UNPAID') =>
  ({ id, student, student_name: name, student_roll: String(student), class_name: 'Class 1 - A', fee_type: 'MONTHLY',
    monthly_category_name: cat, month: 11, year: 2026, amount_due: due, amount_paid: paid, status }) as unknown as FeePayment;

describe('fee list grouping', () => {
  it('groups only when there is more than one fee type', () => {
    expect(shouldGroupByStudent([fee(1, 10, 'Ali', 'Tuition', 3000), fee(2, 11, 'Sara', 'Tuition', 3000)])).toBe(false);
    expect(shouldGroupByStudent([fee(1, 10, 'Ali', 'Tuition', 3000), fee(2, 10, 'Ali', 'Koder Kids', 1500)])).toBe(true);
  });

  it('adds up each student and keeps the list order', () => {
    const groups = groupByStudent([
      fee(1, 10, 'Ali', 'Tuition', 6000), fee(2, 10, 'Ali', 'Koder Kids', 1500, 1500, 'PAID'), fee(3, 11, 'Fatima', 'Tuition', 3000),
    ]);
    expect(groups.map((g) => [g.student_name, g.rows.length, g.due, g.paid, g.balance])).toEqual([
      ['Ali', 2, 7500, 1500, 6000], ['Fatima', 1, 3000, 0, 3000],
    ]);
    expect(groupStatus(groups[0])).toBe('MIXED');
    expect(groupStatus(groups[1])).toBe('UNPAID');
  });
});

describe('generation preview per fee', () => {
  const base: Preview = { will_create: 7, already_exist: 0, no_fee_structure: 0, total_amount: '16200' };
  it('lists each fee with the enrolled count for an optional one', () => {
    expect(perFeeLines({ ...base, categories: [
      { id: 1, name: 'Tuition Fee', billing_mode: 'ALL', in_scope: 4, enrolled: null, will_create: 4, total_amount: '12000.00' },
      { id: 2, name: 'Koder Kids', billing_mode: 'ENROLLED', in_scope: 4, enrolled: 3, will_create: 3, total_amount: '4200.00' },
    ] })).toEqual([
      'Tuition Fee: 4 new, PKR 12,000 (all students)',
      'Koder Kids: 3 new, PKR 4,200 (3 of 4 students enrolled)',
    ]);
  });
  it('says nothing extra for a single fee everyone pays', () => {
    expect(perFeeLines({ ...base, categories: [
      { id: 1, name: 'Tuition Fee', billing_mode: 'ALL', in_scope: 4, enrolled: null, will_create: 4, total_amount: '12000' },
    ] })).toEqual([]);
  });
});

describe('voucher due date', () => {
  it('keeps the school due day while it is ahead, else a week from today', () => {
    expect(defaultDueDate(2026, 12, 10, '2026-11-26')).toEqual({ date: '2026-12-10', late: false, usual: '2026-12-10' });
    expect(defaultDueDate(2026, 11, 10, '2026-11-26')).toEqual({ date: '2026-12-03', late: true, usual: '2026-11-10' });
  });
});
