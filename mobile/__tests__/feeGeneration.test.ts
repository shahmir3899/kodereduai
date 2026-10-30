import {
  buildBulkPayload, buildSinglePayload, confirmText, emptyBulkForm, emptySingleForm, previewParams, previewText, resultText,
  validateBulk, validateSingle, yearOptions,
} from '../services/feeGeneration';

const section = { id: 30, label: '5-A', classObj: 5, isSession: true };
const master = { id: 5, label: '5', classObj: null, isSession: false };
const now = new Date(2026, 9, 29);
const preview = { will_create: 40, already_exist: 3, no_fee_structure: 2, total_amount: '120000.00' };

describe('bulk generation', () => {
  const f = { ...emptyBulkForm(now), categories: [11, 12] };
  it('starts on the current month and year', () => {
    expect(emptyBulkForm(now)).toMatchObject({ kind: 'MONTHLY', month: 10, year: 2026, classOption: null, conflict: 'skip' });
    expect(yearOptions(now)).toEqual([2025, 2026, 2027, 2028]);
  });
  it('previews annual fees with month 0 and the right category list', () => {
    expect(previewParams(f, section, 7)).toEqual({ fee_type: 'MONTHLY', year: 2026, month: 10, session_class_id: 30, academic_year: 7, monthly_categories: '11,12' });
    expect(previewParams({ ...f, kind: 'ANNUAL' }, master)).toEqual({ fee_type: 'ANNUAL', year: 2026, month: 0, class_id: 5, annual_categories: '11,12' });
    expect(previewParams(f, undefined)).not.toHaveProperty('class_id');
  });
  it('asks for a category, a preview, and something to generate', () => {
    expect(validateBulk({ ...f, categories: [] }, preview)).toMatch(/monthly category/);
    expect(validateBulk({ ...f, kind: 'ANNUAL', categories: [] }, preview)).toMatch(/annual category/);
    expect(validateBulk(f, undefined)).toMatch(/preview/);
    expect(validateBulk(f, { ...preview, will_create: 0, already_exist: 0 })).toMatch(/no records/);
    expect(validateBulk(f, { ...preview, will_create: 0 })).toBeNull();
    expect(validateBulk(f, preview)).toBeNull();
  });
  it('sends the monthly or annual payload, a section instead of a class, and the strategy', () => {
    expect(buildBulkPayload({ ...f, conflict: 'update' }, section, 7)).toEqual({
      year: 2026, month: 10, monthly_category_ids: [11, 12], session_class_id: 30, academic_year: 7, conflict_strategy: 'update',
    });
    expect(buildBulkPayload({ ...f, kind: 'ANNUAL' }, master)).toEqual({ year: 2026, annual_category_ids: [11, 12], class_id: 5, conflict_strategy: 'skip' });
    expect(buildBulkPayload(f, undefined)).not.toHaveProperty('session_class_id');
  });
  it('words the preview and the confirmation with the numbers', () => {
    expect(previewText(preview)).toBe('40 new records, 3 already exist, 2 students have no fee set. Total PKR 120,000.');
    expect(previewText({ will_create: 1, already_exist: 0, no_fee_structure: 1, total_amount: '0' })).toBe('1 new record, 1 student has no fee set.');
    expect(confirmText(f, '5-A', preview)).toBe('Monthly fees for 5-A, October 2026.\n40 new records, 3 already exist, 2 students have no fee set. Total PKR 120,000.\nKeep existing records.');
    expect(confirmText({ ...f, kind: 'ANNUAL', conflict: 'delete_recreate' }, '', preview)).toMatch(/^Annual fees for every class, 2026\./);
  });
  it('words the result for an immediate run and a background one', () => {
    expect(resultText(200, { result: { created: 40, updated: 2, skipped: 3, protected_conflict: 1, no_fee_structure: 2 } }))
      .toBe('Created 40 records. Updated 2. Skipped 3. 1 protected record left unchanged. 2 students have no fee set.');
    expect(resultText(202, { message: 'Started.' })).toBe('Started.');
    expect(resultText(200, undefined)).toMatch(/started/);
  });
});

describe('single record', () => {
  const f = { ...emptySingleForm(now), student: 9, category: 11 };
  it('needs a student and a category', () => {
    expect(validateSingle({ ...f, student: null })).toMatch(/student/);
    expect(validateSingle({ ...f, category: null })).toMatch(/monthly category/);
    expect(validateSingle({ ...f, kind: 'ANNUAL', category: null })).toMatch(/annual category/);
    expect(validateSingle({ ...f, year: 1999 })).toMatch(/year/);
    expect(validateSingle(f)).toBeNull();
  });
  it('sends only the category field for its kind, and month 0 for annual', () => {
    expect(buildSinglePayload(f, 7)).toEqual({ student: 9, fee_type: 'MONTHLY', year: 2026, month: 10, monthly_category: 11, academic_year: 7, conflict_strategy: 'skip' });
    expect(buildSinglePayload({ ...f, kind: 'ANNUAL' })).toEqual({ student: 9, fee_type: 'ANNUAL', year: 2026, month: 0, annual_category: 11, conflict_strategy: 'skip' });
  });
});
