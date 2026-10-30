import {
  amountOff, buildAssignPayload, buildBulkPayload, buildDiscountPayload, buildScholarshipPayload, bulkResultText,
  discountScopeText, discountToForm, discountValueText, emptyAssignForm, emptyDiscountForm, emptyScholarshipForm,
  scholarshipToForm, scholarshipValueText, validateAssign, validateDiscount, validateScholarship, type Discount,
} from '../services/discounts';

const disc = (over: Partial<Discount> = {}): Discount => ({
  id: 1, name: 'Sibling', discount_type: 'PERCENTAGE', value: '10.00', applies_to: 'ALL', is_active: true, ...over,
});

describe('wording and amounts', () => {
  it('describes values and scope', () => {
    expect(discountValueText(disc())).toBe('10% off');
    expect(discountValueText(disc({ discount_type: 'FIXED', value: 1500 }))).toBe('PKR 1,500 off');
    expect(scholarshipValueText({ coverage: 'FULL', value: 0 })).toBe('Full waiver');
    expect(scholarshipValueText({ coverage: 'PERCENTAGE', value: 50 })).toBe('50% off');
    expect(discountScopeText(disc({ applies_to: 'GRADE_LEVEL', target_grade_level: 5 }))).toBe('Grade 5');
    expect(discountScopeText(disc({ applies_to: 'CLASS', target_class_name: 'Class 2' }))).toBe('Class 2');
    expect(discountScopeText(disc({ applies_to: 'ALL' }))).toBe('All students');
  });
  it('matches the web discount arithmetic', () => {
    expect(amountOff({ type: 'discount', d: { discount_type: 'PERCENTAGE', value: 12.5 } }, 1000)).toBe(125);
    expect(amountOff({ type: 'discount', d: { discount_type: 'FIXED', value: 5000 } }, 1000)).toBe(1000);
    expect(amountOff({ type: 'scholarship', s: { coverage: 'FULL', value: 0 } }, 800)).toBe(800);
    expect(amountOff({ type: 'scholarship', s: { coverage: 'PERCENTAGE', value: 25 } }, 800)).toBe(200);
    expect(amountOff({ type: 'discount', d: { discount_type: 'FIXED', value: 5 } }, 0)).toBe(0);
  });
});

describe('discount form', () => {
  const ok = { ...emptyDiscountForm(), name: 'Early bird', value: '10' };
  it('checks name, value, percentage cap and scope fields', () => {
    expect(validateDiscount({ ...ok, name: '' })).toMatch(/name/);
    expect(validateDiscount({ ...ok, value: '' })).toMatch(/value/);
    expect(validateDiscount({ ...ok, value: '101' })).toMatch(/0 and 100/);
    expect(validateDiscount({ ...ok, type: 'FIXED', value: '5000' })).toBeNull();
    expect(validateDiscount({ ...ok, appliesTo: 'GRADE_LEVEL' })).toMatch(/grade/i);
    expect(validateDiscount({ ...ok, appliesTo: 'CLASS' })).toMatch(/class/i);
    expect(validateDiscount({ ...ok, startDate: '2026-05-01', endDate: '2026-04-01' })).toMatch(/end date/);
    expect(validateDiscount({ ...ok, maxUses: '2.5' })).toMatch(/whole number/);
    expect(validateDiscount(ok)).toBeNull();
  });
  it('sends only the scope field that applies, and the year', () => {
    expect(buildDiscountPayload({ ...ok, appliesTo: 'GRADE_LEVEL', gradeLevel: '6', targetClass: 9 }, 3)).toMatchObject({
      applies_to: 'GRADE_LEVEL', target_grade_level: 6, target_class: null, academic_year: 3, value: 10, max_uses: null,
    });
    expect(buildDiscountPayload({ ...ok, appliesTo: 'CLASS', targetClass: 9, gradeLevel: '6' })).toMatchObject({ target_class: 9, target_grade_level: null });
    expect(buildDiscountPayload(ok)).not.toHaveProperty('academic_year');
  });
  it('round-trips through the form', () => {
    const f = discountToForm(disc({ applies_to: 'GRADE_LEVEL', target_grade_level: 4, max_uses: 20, stackable: true }));
    expect(f).toMatchObject({ value: '10', appliesTo: 'GRADE_LEVEL', gradeLevel: '4', maxUses: '20', stackable: true });
  });
});

describe('scholarship form', () => {
  const ok = { ...emptyScholarshipForm(), name: 'Merit 2026' };
  it('needs no value for a full waiver, a capped one for a percentage', () => {
    expect(validateScholarship(ok)).toBeNull();
    expect(validateScholarship({ ...ok, coverage: 'PERCENTAGE' })).toMatch(/value/);
    expect(validateScholarship({ ...ok, coverage: 'PERCENTAGE', value: '120' })).toMatch(/0 and 100/);
    expect(validateScholarship({ ...ok, coverage: 'FIXED', value: '3000' })).toBeNull();
    expect(validateScholarship({ ...ok, maxRecipients: 'x' })).toMatch(/whole number/);
  });
  it('sends value 0 for a full waiver', () => {
    expect(buildScholarshipPayload({ ...ok, value: '50' }, 2)).toMatchObject({ coverage: 'FULL', value: 0, academic_year: 2 });
    expect(buildScholarshipPayload({ ...ok, coverage: 'FIXED', value: '3000', maxRecipients: '5' })).toMatchObject({ value: 3000, max_recipients: 5 });
  });
  it('round-trips a full waiver without a value', () => {
    expect(scholarshipToForm({ id: 1, name: 'A', scholarship_type: 'MERIT', coverage: 'FULL', value: 0, is_active: true }).value).toBe('');
  });
});

describe('assignments', () => {
  it('validates single assignment', () => {
    const f = emptyAssignForm();
    expect(validateAssign(f, null)).toMatch(/academic year/);
    expect(validateAssign(f, 1)).toMatch(/student/);
    expect(validateAssign({ ...f, student: 4 }, 1)).toMatch(/discount/);
    expect(validateAssign({ ...f, student: 4, kind: 'scholarship' }, 1)).toMatch(/scholarship/);
    expect(validateAssign({ ...f, student: 4, discount: 2 }, 1)).toBeNull();
  });
  it('sends exactly one of discount or scholarship', () => {
    expect(buildAssignPayload({ ...emptyAssignForm(), student: 4, discount: 2, scholarship: 9, notes: ' x ' }, 7)).toEqual({
      student_id: 4, discount_id: 2, scholarship_id: null, academic_year_id: 7, notes: 'x',
    });
    expect(buildAssignPayload({ ...emptyAssignForm(), kind: 'scholarship', student: 4, discount: 2, scholarship: 9 }, 7)).toMatchObject({ discount_id: null, scholarship_id: 9 });
  });
  it('bulk: a section is sent as session_class_id, a master class as class_id, never both', () => {
    const section = { id: 30, label: '5-A', classObj: 5, isSession: true };
    const master = { id: 5, label: '5', classObj: 5, isSession: false };
    expect(buildBulkPayload('discount', 2, section, 7)).toEqual({ payload: { discount_id: 2, session_class_id: 30, academic_year_id: 7 } });
    expect(buildBulkPayload('scholarship', 3, master, 7)).toEqual({ payload: { scholarship_id: 3, class_id: 5, academic_year_id: 7 } });
    expect(buildBulkPayload('discount', null, section, 7)).toHaveProperty('error');
    expect(buildBulkPayload('discount', 2, null, 7)).toHaveProperty('error');
    expect(buildBulkPayload('discount', 2, section, null)).toHaveProperty('error');
  });
  it('words the bulk result', () => {
    expect(bulkResultText({ created: 12, skipped: 0, total_students: 12 })).toBe('Assigned to 12 students.');
    expect(bulkResultText({ created: 1, skipped: 3, total_students: 4 })).toBe('Assigned to 1 student, 3 already had it.');
    expect(bulkResultText({ created: 0, skipped: 5, total_students: 5 })).toMatch(/already has it/);
    expect(bulkResultText({ created: 0, skipped: 0, total_students: 0 })).toMatch(/No students/);
  });
});
