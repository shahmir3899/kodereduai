import {
  bulkDeleteFeesResultText, bulkDeleteFeesText, bulkPayPayload, bulkPayResultText, bulkPayText, bulkPayTotal, deletableIds, payableIds,
  skippedNote, validateBulkPay, type FeePayment,
} from '../services/feeCollect';

const fee = (id: number, status: FeePayment['status'], due: number, paid: number): FeePayment =>
  ({ id, student: id, student_name: `S${id}`, fee_type: 'MONTHLY', month: 11, year: 2026, amount_due: due, amount_paid: paid, status }) as FeePayment;

const rows = [
  fee(1, 'UNPAID', 1000, 0),
  fee(2, 'PARTIAL', 1000, 400),
  fee(3, 'PAID', 1000, 1000),
  fee(4, 'ADVANCE', 1000, 1500),
  fee(5, 'UNPAID', 0, 0),
];

describe('which records a bulk action may touch', () => {
  it('pays in full only what still owes something, and only what is selected', () => {
    expect(payableIds(rows, [1, 2, 3, 4, 5])).toEqual([1, 2]);
    expect(payableIds(rows, [3, 4])).toEqual([]);
    expect(payableIds(rows, [2])).toEqual([2]);
    expect(payableIds(rows, [])).toEqual([]);
  });

  it('deletes only records with nothing paid, never a part-paid or paid one', () => {
    expect(deletableIds(rows, [1, 2, 3, 4, 5])).toEqual([1, 5]);
    expect(deletableIds(rows, [2, 3])).toEqual([]);
  });

  it('adds up the balances that would be paid', () => {
    expect(bulkPayTotal(rows, [1, 2])).toBe(1600);
    expect(bulkPayTotal(rows, [3])).toBe(0);
    expect(bulkPayTotal(rows, [])).toBe(0);
  });
});

describe('validating a bulk payment', () => {
  it('needs something payable and an account', () => {
    expect(validateBulkPay(7, [1])).toBeNull();
    expect(validateBulkPay(null, [1])).toBe('Choose the account the money goes into.');
    expect(validateBulkPay(7, [])).toBe('Nothing selected can be paid: those records are already paid.');
  });

  it('builds the pay-in-full request the server reads', () => {
    expect(bulkPayPayload([1, 2], 7, 'BANK_TRANSFER')).toEqual({ pay_full: true, ids: [1, 2], account: 7, payment_method: 'BANK_TRANSFER' });
  });
});

describe('wording', () => {
  it('says exactly what will happen before it does', () => {
    expect(bulkPayText(2, 1600, 'Fund', 'Cash')).toBe('2 fee records will be marked as fully paid, PKR 1,600 in all, by Cash into Fund.');
    expect(bulkPayText(1, 500, 'Fund', 'Cash')).toContain('1 fee record will');
    expect(bulkDeleteFeesText(1)).toBe('1 fee record with nothing paid will be deleted. This cannot be undone.');
    expect(bulkDeleteFeesText(3)).toBe('3 fee records with nothing paid will be deleted. This cannot be undone.');
  });

  it('notes what was left out', () => {
    expect(skippedNote(5, 2)).toBe(' 3 left out.');
    expect(skippedNote(2, 2)).toBe('');
    expect(skippedNote(0, 0)).toBe('');
  });

  it('reports what the server did, including what it could not', () => {
    expect(bulkPayResultText({ updated: 2, errors: [] })).toBe('2 fee records marked as paid.');
    expect(bulkPayResultText({ updated: 1, errors: ['Record 9 not found'] })).toBe('1 fee record marked as paid. 1 could not be: Record 9 not found');
    expect(bulkPayResultText(null)).toBe('0 fee records marked as paid.');
    expect(bulkDeleteFeesResultText({ deleted: 3 })).toBe('3 fee records deleted.');
    expect(bulkDeleteFeesResultText({ deleted: 1, errors: ['Record 4: Period 2026/11 is closed.'] })).toBe('1 fee record deleted. 1 could not be: Record 4: Period 2026/11 is closed.');
  });
});
