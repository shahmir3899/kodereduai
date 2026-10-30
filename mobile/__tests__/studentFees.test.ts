import type { FeeStructure } from '../services/feeStructure';
import {
  buildStudentFeePayload, buildStudentRows, changedStudentRows, classDefaultAmount, isOverride, overrideAmounts, studentFeeSummary,
  validateStudentFees,
} from '../services/studentFees';

const fs = (over: Partial<FeeStructure>): FeeStructure => ({
  id: 1, class_obj: 5, student: null, fee_type: 'MONTHLY', monthly_amount: '3000.00', is_active: true, ...over,
});

const students = [
  { id: 11, name: 'Zara', roll_number: '2' }, { id: 12, name: 'Ali', roll_number: '1' }, { id: 13, name: 'Omar', roll_number: null },
];

describe('amounts in force', () => {
  const monthly = [fs({}), fs({ id: 2, class_obj: null, student: 11, monthly_amount: '2500.00' }), fs({ id: 3, class_obj: 6, monthly_amount: '9999' })];

  it('reads the class charge and the student overrides', () => {
    expect(classDefaultAmount(monthly, 5, 'MONTHLY', null)).toBe('3000');
    expect(classDefaultAmount(monthly, 7, 'MONTHLY', null)).toBe('');
    expect(overrideAmounts(monthly, 'MONTHLY', null)).toEqual({ 11: '2500' });
  });

  it('keeps annual categories apart and ignores inactive rows', () => {
    const annual = [
      fs({ id: 1, fee_type: 'ANNUAL', annual_category: 1, monthly_amount: '10000' }),
      fs({ id: 2, fee_type: 'ANNUAL', annual_category: 2, monthly_amount: '500' }),
      fs({ id: 3, fee_type: 'ANNUAL', annual_category: 1, class_obj: null, student: 12, monthly_amount: '8000', is_active: false }),
    ];
    expect(classDefaultAmount(annual, 5, 'ANNUAL', 2)).toBe('500');
    expect(overrideAmounts(annual, 'ANNUAL', 1)).toEqual({});
  });
});

describe('rows', () => {
  const structures = [fs({}), fs({ id: 2, class_obj: null, student: 11, monthly_amount: '2500' })];

  it('sorts by roll number, then name, and starts from the override or the class charge', () => {
    const rows = buildStudentRows(students, structures, 5, 'MONTHLY', null, {});
    expect(rows.map((r) => r.name)).toEqual(['Ali', 'Zara', 'Omar']);
    expect(rows.find((r) => r.studentId === 11)).toMatchObject({ amount: '2500', original: '2500', edited: false });
    expect(rows.find((r) => r.studentId === 12)).toMatchObject({ amount: '3000', original: '3000' });
    expect(isOverride(rows.find((r) => r.studentId === 11)!)).toBe(true);
    expect(isOverride(rows.find((r) => r.studentId === 12)!)).toBe(false);
  });

  it('sends only edited rows that really changed', () => {
    const rows = buildStudentRows(students, structures, 5, 'MONTHLY', null, { 12: '2000', 11: '2500', 13: '' });
    expect(changedStudentRows(rows).map((r) => r.studentId)).toEqual([12]);
  });
});

describe('validation and payload', () => {
  const rowsFor = (edits: Record<number, string>) => buildStudentRows(students, [fs({})], 5, 'MONTHLY', null, edits);

  it('needs a change, a date and valid amounts', () => {
    expect(validateStudentFees(rowsFor({}), '2026-11-01', 'MONTHLY', null)).toMatch(/at least one/);
    expect(validateStudentFees(rowsFor({ 12: '2000' }), '', 'MONTHLY', null)).toMatch(/date/);
    expect(validateStudentFees(rowsFor({ 12: 'abc' }), '2026-11-01', 'MONTHLY', null)).toMatch(/Ali/);
    expect(validateStudentFees(rowsFor({ 12: '-5' }), '2026-11-01', 'MONTHLY', null)).toMatch(/Ali/);
    expect(validateStudentFees(rowsFor({ 12: '2000' }), '2026-11-01', 'ANNUAL', null)).toMatch(/category/);
    expect(validateStudentFees(rowsFor({ 12: '0' }), '2026-11-01', 'MONTHLY', null)).toBeNull();
  });

  it('builds a monthly payload without a category and an annual one with it', () => {
    expect(buildStudentFeePayload(5, 'MONTHLY', null, '2026-11-01', rowsFor({ 12: '2000' }))).toEqual({
      class_id: 5, fee_type: 'MONTHLY', effective_from: '2026-11-01', students: [{ student_id: 12, monthly_amount: '2000' }],
    });
    expect(buildStudentFeePayload(5, 'ANNUAL', 3, '2026-11-01', rowsFor({ 12: '2000' })).students)
      .toEqual([{ student_id: 12, monthly_amount: '2000', annual_category: 3 }]);
  });

  it('summarises the change for the confirmation', () => {
    expect(studentFeeSummary('Class 5', rowsFor({ 12: '2000' }), '2026-11-01')).toBe('Class 5, from 2026-11-01\nAli: 3000 to 2,000');
  });
});
