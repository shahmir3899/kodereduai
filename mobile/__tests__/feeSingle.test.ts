import {
  buildSinglePayload, emptySingleForm, receivedAmount, singleResultText, structureText, validateSingle, type SingleForm,
} from '../services/feeGeneration';

const now = new Date(2026, 10, 3);
const base: SingleForm = { ...emptySingleForm(now), student: 9, category: 11 };

describe('the empty form', () => {
  it('starts monthly for this month, with nothing received and today as the payment date', () => {
    expect(emptySingleForm(now)).toMatchObject({ kind: 'MONTHLY', month: 11, year: 2026, conflict: 'skip', received: '', account: null, method: 'CASH', paidDate: '2026-11-03', notes: '' });
  });
});

describe('structure amount', () => {
  it('names the amount and where it comes from', () => {
    expect(structureText(3000, 'student_override')).toBe("PKR 3,000 · this student's own fee");
    expect(structureText(3000, 'class_default')).toBe("PKR 3,000 · the class's fee");
    expect(structureText(1250.4, null)).toBe("PKR 1,250 · the class's fee");
    expect(structureText(null, null)).toBe('No fee is set for this student and category.');
    expect(structureText(undefined, null)).toBe('No fee is set for this student and category.');
  });

  it('stops a record the server would refuse, but waits while the amount is loading', () => {
    expect(validateSingle(base, null)).toBe('No fee is set for this student and category. Set it in Fee setup first.');
    expect(validateSingle(base, undefined)).toBeNull();
    expect(validateSingle(base, 3000)).toBeNull();
  });
});

describe('amount received now', () => {
  it('reads a blank as nothing and a number as the amount', () => {
    expect(receivedAmount({ received: '' })).toBe(0);
    expect(receivedAmount({ received: '  ' })).toBe(0);
    expect(receivedAmount({ received: '1500' })).toBe(1500);
    expect(receivedAmount({ received: 'abc' })).toBeNaN();
  });

  it('needs a number that is not negative', () => {
    expect(validateSingle({ ...base, received: 'abc' }, 3000)).toBe('Enter the amount received as a number, or leave it empty.');
    expect(validateSingle({ ...base, received: '-5' }, 3000)).toBe('Enter the amount received as a number, or leave it empty.');
    expect(validateSingle({ ...base, received: '0' }, 3000)).toBeNull();
  });

  it('needs an account and a date once something is received', () => {
    expect(validateSingle({ ...base, received: '1000' }, 3000)).toBe('Choose the account the money goes into.');
    expect(validateSingle({ ...base, received: '1000', account: 7, paidDate: '' }, 3000)).toBe('Choose the payment date.');
    expect(validateSingle({ ...base, received: '1000', account: 7 }, 3000)).toBeNull();
  });

  it('cannot exceed an annual fee, which is exactly the structure amount', () => {
    const annual = { ...base, kind: 'ANNUAL' as const, received: '4000', account: 7 };
    expect(validateSingle(annual, 3000)).toBe('The amount received is more than the fee.');
    expect(validateSingle({ ...annual, received: '3000' }, 3000)).toBeNull();
    // a monthly record can also carry a balance from before, so the server decides
    expect(validateSingle({ ...base, received: '4000', account: 7 }, 3000)).toBeNull();
  });
});

describe('the request', () => {
  it('sends no payment fields and no notes when there is nothing to say', () => {
    expect(buildSinglePayload(base, 7)).toEqual({ student: 9, fee_type: 'MONTHLY', year: 2026, month: 11, monthly_category: 11, academic_year: 7, conflict_strategy: 'skip' });
  });

  it('sends the payment together, and the notes trimmed', () => {
    const payload = buildSinglePayload({ ...base, received: '1500', account: 7, method: 'BANK_TRANSFER', paidDate: '2026-11-02', notes: '  new admission  ' }, 7);
    expect(payload).toMatchObject({ amount_paid: 1500, account: 7, payment_method: 'BANK_TRANSFER', payment_date: '2026-11-02', notes: 'new admission' });
  });

  it('leaves the payment out when the amount is zero, even if an account was picked earlier', () => {
    const payload = buildSinglePayload({ ...base, received: '0', account: 7 }, 7);
    expect(payload).not.toHaveProperty('amount_paid');
    expect(payload).not.toHaveProperty('account');
  });
});

describe('what the server did', () => {
  it('says created, with the amount received when there was one', () => {
    expect(singleResultText({ created: true })).toBe('Fee record created.');
    expect(singleResultText({ created: true }, 1500)).toBe('Fee record created, with PKR 1,500 received.');
  });

  it('never calls an existing record a new one', () => {
    expect(singleResultText({ created: false, skipped: true, message: 'Fee record already exists and matches current fee structure.' })).toBe('Fee record already exists and matches current fee structure.');
    expect(singleResultText({ skipped: true })).toBe('A record already exists, so nothing was changed.');
    expect(singleResultText({ updated: true, message: 'Existing fee record updated using current fee structure.' })).toBe('Existing fee record updated using current fee structure.');
    expect(singleResultText({ updated: true })).toBe('Existing fee record updated.');
    expect(singleResultText(undefined)).toBe('Done.');
  });
});
