import { STATUS_TABS, canDeleteFee, categoryOptions, feeDescription, filterPayments, type FeePayment } from '../services/feeCollect';

const fee = (over: Partial<FeePayment>): FeePayment => ({
  id: 1, student: 1, student_name: 'Ali Raza', fee_type: 'MONTHLY', monthly_category_name: 'Tuition Fee', month: 11, year: 2026,
  amount_due: 8500, amount_paid: 0, status: 'UNPAID', ...over,
} as FeePayment);

describe('status tabs', () => {
  it('has the web statuses with All first and Advance last', () => {
    expect(STATUS_TABS.map((t) => t.value)).toEqual(['ALL', 'UNPAID', 'PARTIAL', 'PAID', 'ADVANCE']);
  });
});

describe('category filter', () => {
  const list = [
    fee({ id: 1 }),
    fee({ id: 2, monthly_category_name: 'Transport Fee' }),
    fee({ id: 3, fee_type: 'ANNUAL', monthly_category_name: null, annual_category_name: 'Annual Charges' }),
  ];

  it('lists each category once, sorted', () => {
    expect(categoryOptions([...list, fee({ id: 4 })])).toEqual(['Annual Charges', 'Transport Fee', 'Tuition Fee']);
  });

  it('keeps only the chosen category and does nothing when none is chosen', () => {
    expect(filterPayments(list, { category: 'Transport Fee' }).map((p) => p.id)).toEqual([2]);
    expect(filterPayments(list, {})).toHaveLength(3);
    expect(filterPayments(list, { category: 'Tuition Fee', status: 'PAID' })).toHaveLength(0);
  });
});

describe('canDeleteFee', () => {
  it('allows only an unpaid record with nothing received', () => {
    expect(canDeleteFee({ status: 'UNPAID', amount_paid: 0 })).toBe(true);
    expect(canDeleteFee({ status: 'UNPAID', amount_paid: '0.00' })).toBe(true);
    expect(canDeleteFee({ status: 'PARTIAL', amount_paid: 500 })).toBe(false);
    expect(canDeleteFee({ status: 'PAID', amount_paid: 8500 })).toBe(false);
    expect(canDeleteFee({ status: 'ADVANCE', amount_paid: 9000 })).toBe(false);
    expect(canDeleteFee({ status: 'UNPAID', amount_paid: 100 })).toBe(false);
  });
});

describe('feeDescription', () => {
  it('names the student, fee and month', () => {
    expect(feeDescription(fee({}))).toBe('Ali Raza: Tuition Fee, November 2026');
    expect(feeDescription(fee({ month: 0 as never, fee_type: 'ANNUAL', monthly_category_name: null, annual_category_name: 'Annual Charges' }))).toBe('Ali Raza: Annual Charges, 2026');
  });
});
