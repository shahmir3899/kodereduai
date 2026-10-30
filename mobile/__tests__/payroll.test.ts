import {
  breakdownLines, buildSalaryPayload, dictFromPairs, emptySalaryForm, generationText, pairsFromDict, payslipActions,
  payslipFileName, salaryPreview, salaryToForm, summaryLine, validateSalary, type SalaryStructure,
} from '../services/payroll';

describe('payslip actions follow the server rules', () => {
  it('draft: approve, pay, delete; approved: pay only; paid: nothing', () => {
    expect(payslipActions('DRAFT')).toEqual({ approve: true, markPaid: true, remove: true });
    expect(payslipActions('APPROVED')).toEqual({ approve: false, markPaid: true, remove: false });
    expect(payslipActions('PAID')).toEqual({ approve: false, markPaid: false, remove: false });
  });
});

describe('wording', () => {
  it('turns a breakdown into labelled lines and drops zeros', () => {
    expect(breakdownLines({ house_rent: '10000.00', transport: 0, medical_allowance: 500 })).toEqual([
      { label: 'House rent', amount: 10000 }, { label: 'Medical allowance', amount: 500 },
    ]);
    expect(breakdownLines(null)).toEqual([]);
  });
  it('summarises a month', () => {
    expect(summaryLine({ month: 10, year: 2026, total_payslips: 1, total_basic: '0', total_allowances: '0', total_deductions: '0', total_net: '0', draft_count: 1, approved_count: 0, paid_count: 0 }))
      .toBe('1 payslip · 1 draft · 0 approved · 0 paid');
  });
  it('words generation for a finished run and for a background one', () => {
    expect(generationText(200, { result: { created: 12, skipped: 3 } })).toBe('12 payslips created, 3 skipped.');
    expect(generationText(200, { result: { created: 1, skipped: 0 } })).toBe('1 payslip created.');
    expect(generationText(200, { message: 'Payslips generated.' })).toBe('Payslips generated.');
    expect(generationText(202, { message: 'Payslip generation started.' })).toBe('Payslip generation started.');
    expect(generationText(202, undefined)).toMatch(/started/);
  });
  it('names the PDF file safely', () => {
    expect(payslipFileName({ month: 3, year: 2026 }, "Ali / Khan's")).toBe('Payslip_Ali_Khan_s_2026-03.pdf');
    expect(payslipFileName({ month: 11, year: 2026 }, '')).toBe('Payslip_Staff_2026-11.pdf');
  });
});

describe('salary form', () => {
  const ok = { ...emptySalaryForm('2026-11-01'), staff: 4, basic: '50000' };
  it('turns allowance names into the keys the server stores', () => {
    expect(dictFromPairs([{ key: ' House Rent ', amount: '10000' }, { key: '', amount: '' }, { key: 'Transport', amount: '0' }])).toEqual({ house_rent: 10000, transport: 0 });
    expect(pairsFromDict({ house_rent: '10000.00' })).toEqual([{ key: 'house_rent', amount: '10000' }]);
  });
  it('validates staff, basic, rows and date', () => {
    expect(validateSalary({ ...ok, staff: null }, true)).toMatch(/staff/);
    expect(validateSalary({ ...ok, staff: null }, false)).toBeNull();
    expect(validateSalary({ ...ok, basic: '' }, true)).toMatch(/basic/);
    expect(validateSalary({ ...ok, allowances: [{ key: 'Rent', amount: '' }] }, true)).toMatch(/amount for "Rent"/);
    expect(validateSalary({ ...ok, deductions: [{ key: '', amount: '50' }] }, true)).toMatch(/name/);
    expect(validateSalary({ ...ok, allowances: [{ key: 'Rent', amount: '1' }, { key: 'rent', amount: '2' }] }, true)).toMatch(/twice/);
    expect(validateSalary({ ...ok, effectiveFrom: '' }, true)).toMatch(/date/);
    expect(validateSalary(ok, true)).toBeNull();
  });
  it('previews gross and net like the web', () => {
    expect(salaryPreview({ basic: '50000', allowances: [{ key: 'rent', amount: '10000' }], deductions: [{ key: 'tax', amount: '2500' }] })).toEqual({ gross: 60000, deductions: 2500, net: 57500 });
  });
  it('sends the staff member only when creating', () => {
    const f = { ...ok, allowances: [{ key: 'Rent', amount: '10000' }] };
    expect(buildSalaryPayload(f, true)).toMatchObject({ staff_member: 4, basic_salary: 50000, allowances: { rent: 10000 }, deductions: {}, is_active: true });
    expect(buildSalaryPayload(f, false)).not.toHaveProperty('staff_member');
  });
  it('round-trips a structure through the form', () => {
    const s: SalaryStructure = {
      id: 1, staff_member: 4, staff_member_name: 'A', basic_salary: '50000.00', allowances: { rent: 100 }, deductions: {}, effective_from: '2026-01-01', is_active: true,
    };
    expect(salaryToForm(s)).toMatchObject({ staff: 4, basic: '50000', effectiveFrom: '2026-01-01', allowances: [{ key: 'rent', amount: '100' }] });
  });
});
