import {
  balanceOf, buildPaymentPatch, canRecordPayment, emptyPaymentForm, feeLabel, filterPayments, formatMoney,
  sortPayments, stepFeeMonth, summarize, validatePayment, type FeePayment, type PaymentForm,
} from '../services/feeCollect';

const pay = (id: number, extra: Partial<FeePayment> = {}): FeePayment => ({
  id, student: id, student_name: `S${id}`, student_roll: String(id), fee_type: 'MONTHLY', month: 10, year: 2026,
  amount_due: 1000, amount_paid: 0, status: 'UNPAID', class_obj_id: 5, session_class_id: 11, ...extra,
});

describe('balances and totals', () => {
  it('is what is still owed, never negative', () => {
    expect(balanceOf(pay(1))).toBe(1000);
    expect(balanceOf(pay(1, { amount_paid: '300.50' }))).toBe(699.5);
    expect(balanceOf(pay(1, { amount_paid: 1500 }))).toBe(0);
  });

  it('adds up due, paid, pending and the count per status', () => {
    const s = summarize([pay(1), pay(2, { amount_paid: 400, status: 'PARTIAL' }), pay(3, { amount_paid: 1000, status: 'PAID' })]);
    expect(s).toMatchObject({ due: 3000, paid: 1400, pending: 1600 });
    expect(s.count).toEqual({ UNPAID: 1, PARTIAL: 1, PAID: 1, ADVANCE: 0 });
  });

  it('formats money', () => {
    expect(formatMoney(12345.6)).toBe('PKR 12,346');
  });

  it('only unpaid and part-paid records take a payment', () => {
    expect(canRecordPayment({ status: 'UNPAID' })).toBe(true);
    expect(canRecordPayment({ status: 'PARTIAL' })).toBe(true);
    expect(canRecordPayment({ status: 'PAID' })).toBe(false);
    expect(canRecordPayment({ status: 'ADVANCE' })).toBe(false);
  });
});

describe('filterPayments', () => {
  const list = [
    pay(1, { session_class_id: 11, class_obj_id: 5 }),
    pay(2, { session_class_id: 12, class_obj_id: 5, student_name: 'Zainab', student_roll: '22' }),
    pay(3, { session_class_id: null, class_obj_id: 6, status: 'PAID' }),
  ];

  it('keeps one section apart from its sibling under the same master class', () => {
    expect(filterPayments(list, { masterClassId: 5, sessionClassId: 11 }).map((p) => p.id)).toEqual([1]);
  });

  it('falls back to the master class when a record has no section', () => {
    expect(filterPayments(list, { masterClassId: 6, sessionClassId: 99 }).map((p) => p.id)).toEqual([3]);
    expect(filterPayments(list, { masterClassId: 5 }).map((p) => p.id)).toEqual([1, 2]);
  });

  it('filters by status and by name or roll number', () => {
    expect(filterPayments(list, { status: 'PAID' }).map((p) => p.id)).toEqual([3]);
    expect(filterPayments(list, { search: ' zain ' }).map((p) => p.id)).toEqual([2]);
    expect(filterPayments(list, { search: '22' }).map((p) => p.id)).toEqual([2]);
  });
});

describe('sortPayments and labels', () => {
  it('orders by class, then roll, with one student monthly before annual', () => {
    const sorted = sortPayments([
      pay(3, { student: 1, student_roll: '1', fee_type: 'ANNUAL', class_name: 'A' }),
      pay(2, { student: 2, student_roll: '2', class_name: 'A' }),
      pay(1, { student: 1, student_roll: '1', fee_type: 'MONTHLY', class_name: 'A' }),
      pay(4, { student: 9, student_roll: '1', class_name: 'B' }),
    ]);
    expect(sorted.map((p) => p.id)).toEqual([1, 3, 2, 4]);
  });

  it('names a fee by category, else type', () => {
    expect(feeLabel(pay(1, { monthly_category_name: 'Tuition' }))).toBe('Tuition');
    expect(feeLabel(pay(1, { fee_type_display: 'Monthly Fee' }))).toBe('Monthly Fee');
    expect(feeLabel(pay(1))).toBe('MONTHLY');
  });
});

describe('recording a payment', () => {
  const today = '2026-10-28';
  const form = (over: Partial<PaymentForm> = {}): PaymentForm => ({ ...emptyPaymentForm(1000, today, 3), ...over });

  it('starts with the balance as the amount, today, cash', () => {
    expect(emptyPaymentForm(700, today)).toMatchObject({ amount: '700', method: 'CASH', date: today, account: null });
    expect(emptyPaymentForm(0, today).amount).toBe('');
  });

  it('accepts a valid payment', () => {
    expect(validatePayment(form(), 1000, today)).toBeNull();
    expect(validatePayment(form({ amount: '250.50' }), 1000, today)).toBeNull();
  });

  it('rejects a missing, zero, malformed or too-large amount', () => {
    expect(validatePayment(form({ amount: '' }), 1000, today)).toBe('Enter the amount received');
    expect(validatePayment(form({ amount: '0' }), 1000, today)).toBe('Enter the amount received');
    expect(validatePayment(form({ amount: '12abc' }), 1000, today)).toBe('Enter the amount received');
    expect(validatePayment(form({ amount: '1.234' }), 1000, today)).toBe('Enter the amount received');
    expect(validatePayment(form({ amount: '1200' }), 1000, today)).toBe('Amount is more than the balance (PKR 1,000)');
  });

  it('needs an account and a sensible date', () => {
    expect(validatePayment(form({ account: null }), 1000, today)).toBe('Please select an account');
    expect(validatePayment(form({ date: '' }), 1000, today)).toBe('Please pick the payment date');
    expect(validatePayment(form({ date: '2026-10-29' }), 1000, today)).toBe('The payment date cannot be in the future');
  });

  it('sends the new TOTAL received, because the API stores the total, not the instalment', () => {
    const patch = buildPaymentPatch({ amount_paid: '300' }, form({ amount: '700', receipt: ' R-9 ', notes: ' ok ' }));
    expect(patch).toEqual({
      amount_paid: 1000, payment_method: 'CASH', account: 3, payment_date: today, receipt_number: 'R-9', notes: 'ok',
    });
    expect(buildPaymentPatch({ amount_paid: 0 }, form({ amount: '250.5' })).amount_paid).toBe(250.5);
    expect(buildPaymentPatch({ amount_paid: '0.1' }, form({ amount: '0.2' })).amount_paid).toBe(0.3);
  });
});

describe('stepFeeMonth', () => {
  const current = { year: 2026, month: 10 };
  it('rolls over year ends and never passes the current month', () => {
    expect(stepFeeMonth(2026, 1, -1, current)).toEqual({ year: 2025, month: 12 });
    expect(stepFeeMonth(2025, 12, 1, current)).toEqual({ year: 2026, month: 1 });
    expect(stepFeeMonth(2026, 10, 1, current)).toEqual({ year: 2026, month: 10 });
  });
});
