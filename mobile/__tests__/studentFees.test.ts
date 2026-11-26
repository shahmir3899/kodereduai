import type { FeeStructure } from '../services/feeStructure';
import {
  buildStudentFeePayload, buildStudentRows, changeCountsText, changedCells, classDefaultAmount, isOverride, overrideAmounts, rowTotal,
  studentFeeSummary, validateStudentFees,
} from '../services/studentFees';

const fs = (over: Partial<FeeStructure>): FeeStructure => ({
  id: 1, class_obj: 5, student: null, fee_type: 'MONTHLY', monthly_amount: '3000.00', monthly_category: 1, is_active: true, ...over,
});

const tuition = { id: 1, name: 'Tuition' };
const kids = { id: 2, name: 'Koder Kids' };
const robotics = { id: 3, name: 'Robotics', billing_mode: 'ENROLLED', default_amount: '1500.00' };

const students = [
  { id: 11, name: 'Zara', roll_number: '2' }, { id: 12, name: 'Ali', roll_number: '1' }, { id: 13, name: 'Omar', roll_number: null },
];

describe('amounts in force', () => {
  const monthly = [
    fs({}),
    fs({ id: 2, monthly_category: 2, monthly_amount: '800' }),
    fs({ id: 3, class_obj: null, student: 11, monthly_amount: '2500.00' }),
    fs({ id: 4, class_obj: 6, monthly_amount: '9999' }),
  ];

  it('reads the class charge and the student overrides per category', () => {
    expect(classDefaultAmount(monthly, 5, 'MONTHLY', tuition)).toBe('3000');
    expect(classDefaultAmount(monthly, 5, 'MONTHLY', kids)).toBe('800');
    expect(classDefaultAmount(monthly, 7, 'MONTHLY', tuition)).toBe('');
    expect(overrideAmounts(monthly, 'MONTHLY', tuition)).toEqual({ 11: { amount: '2500', legacy: false } });
    expect(overrideAmounts(monthly, 'MONTHLY', kids)).toEqual({});
  });

  it('shows an old uncategorised override on every fee that is not enrolled-only', () => {
    const old = [fs({}), fs({ id: 2, class_obj: null, student: 12, monthly_category: null, monthly_amount: '2000' })];
    expect(overrideAmounts(old, 'MONTHLY', kids)).toEqual({ 12: { amount: '2000', legacy: true } });
    expect(overrideAmounts(old, 'MONTHLY', robotics)).toEqual({});
  });

  it('falls back to the default price of an enrolled-only fee', () => {
    expect(classDefaultAmount([], 5, 'MONTHLY', robotics)).toBe('1500');
  });

  it('keeps annual categories apart and ignores inactive rows', () => {
    const annual = [
      fs({ id: 1, fee_type: 'ANNUAL', monthly_category: null, annual_category: 1, monthly_amount: '10000' }),
      fs({ id: 2, fee_type: 'ANNUAL', monthly_category: null, annual_category: 2, monthly_amount: '500' }),
      fs({ id: 3, fee_type: 'ANNUAL', monthly_category: null, annual_category: 1, class_obj: null, student: 12, monthly_amount: '8000', is_active: false }),
    ];
    expect(classDefaultAmount(annual, 5, 'ANNUAL', kids)).toBe('500');
    expect(overrideAmounts(annual, 'ANNUAL', tuition)).toEqual({});
  });
});

describe('rows', () => {
  const structures = [fs({}), fs({ id: 2, monthly_category: 2, monthly_amount: '800' }), fs({ id: 3, class_obj: null, student: 11, monthly_amount: '2500' })];

  it('sorts by roll number, then name, with one box per chosen fee', () => {
    const rows = buildStudentRows(students, structures, 5, 'MONTHLY', [tuition, kids], {});
    expect(rows.map((r) => r.name)).toEqual(['Ali', 'Zara', 'Omar']);
    const zara = rows.find((r) => r.studentId === 11)!;
    expect(zara.cells[1]).toMatchObject({ amount: '2500', original: '2500', edited: false });
    expect(zara.cells[2]).toMatchObject({ amount: '800', original: '800' });
    expect(isOverride(zara.cells[1])).toBe(true);
    expect(isOverride(zara.cells[2])).toBe(false);
    expect(rowTotal(zara)).toBe(3300);
  });

  it('sends only edited boxes that really changed', () => {
    const rows = buildStudentRows(students, structures, 5, 'MONTHLY', [tuition, kids], { 1: { 12: '2000', 11: '2500' }, 2: { 13: '', 12: '900' } });
    expect(changedCells(rows).map((c) => [c.studentId, c.categoryId])).toEqual([[12, 1], [12, 2]]);
  });
});

describe('validation and payload', () => {
  const rowsFor = (edits: Record<number, Record<number, string>>) => buildStudentRows(students, [fs({})], 5, 'MONTHLY', [tuition, kids], edits);

  it('needs a fee, a change, a date and valid amounts', () => {
    expect(validateStudentFees(rowsFor({}), '2026-11-01', [])).toMatch(/at least one fee/);
    expect(validateStudentFees(rowsFor({}), '2026-11-01', [1])).toMatch(/at least one student/);
    expect(validateStudentFees(rowsFor({ 1: { 12: '2000' } }), '', [1])).toMatch(/date/);
    expect(validateStudentFees(rowsFor({ 1: { 12: 'abc' } }), '2026-11-01', [1])).toMatch(/Ali/);
    expect(validateStudentFees(rowsFor({ 2: { 12: '-5' } }), '2026-11-01', [1, 2])).toMatch(/Ali/);
    expect(validateStudentFees(rowsFor({ 1: { 12: '0' } }), '2026-11-01', [1])).toBeNull();
  });

  it('names the category on every row, monthly and annual', () => {
    expect(buildStudentFeePayload(5, 'MONTHLY', '2026-11-01', rowsFor({ 1: { 12: '2000' }, 2: { 11: '700' } }))).toEqual({
      class_id: 5, fee_type: 'MONTHLY', effective_from: '2026-11-01',
      students: [{ student_id: 12, monthly_amount: '2000', monthly_category: 1 }, { student_id: 11, monthly_amount: '700', monthly_category: 2 }],
    });
    const annualRows = buildStudentRows(students, [], 5, 'ANNUAL', [kids], { 2: { 12: '2000' } });
    expect(buildStudentFeePayload(5, 'ANNUAL', '2026-11-01', annualRows).students)
      .toEqual([{ student_id: 12, monthly_amount: '2000', annual_category: 2 }]);
  });

  it('summarises the change per fee for the confirmation', () => {
    const rows = rowsFor({ 1: { 12: '2000' }, 2: { 12: '500' } });
    expect(changeCountsText(changedCells(rows), [tuition, kids])).toBe('Tuition: 1 · Koder Kids: 1');
    expect(studentFeeSummary('Class 5', rows, [tuition, kids], '2026-11-01'))
      .toBe('Class 5, from 2026-11-01\nTuition: 1 · Koder Kids: 1\nAli · Tuition: 3000 to 2,000\nAli · Koder Kids: none to 500');
  });
});
