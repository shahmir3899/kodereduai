import {
  buildFeePayload, changedRows, changeSummary, emptyRow, feeClassOptions, savedRows, totalOf, validateRows, type FeeStructure,
} from '../services/feeStructure';

const fs = (over: Partial<FeeStructure> = {}): FeeStructure => ({
  id: 1, class_obj: 5, student: null, fee_type: 'MONTHLY', monthly_amount: '2500.00', monthly_category: 11, annual_category: null, is_active: true, ...over,
});

describe('saved rows', () => {
  it('lists the class-level active charges for one class and kind, once per category', () => {
    const rows = savedRows([
      fs(), fs({ id: 2, monthly_category: 12, monthly_amount: 500 }),
      fs({ id: 3, class_obj: 6 }), fs({ id: 4, student: 9 }), fs({ id: 5, is_active: false, monthly_category: 13 }),
      fs({ id: 6, monthly_category: 11, monthly_amount: 9999 }), fs({ id: 7, fee_type: 'ANNUAL', annual_category: 3, monthly_category: null }),
    ], 5, 'MONTHLY');
    expect(rows).toEqual([
      { category: 11, amount: '2500', saved: '2500' },
      { category: 12, amount: '500', saved: '500' },
    ]);
  });
  it('reads the annual category for annual charges', () => {
    expect(savedRows([fs({ fee_type: 'ANNUAL', annual_category: 3, monthly_category: null, monthly_amount: 12000 })], 5, 'ANNUAL'))
      .toEqual([{ category: 3, amount: '12000', saved: '12000' }]);
  });
});

describe('class options', () => {
  const masters = [{ id: 5, name: 'Class 5' }, { id: 6, name: 'Class 6' }, { id: 7, name: 'Class 7' }];
  it('lists only master classes that have a section this year', () => {
    const sections = [{ id: 30, label: '5-A', classObj: 5, isSession: true }, { id: 31, label: '5-B', classObj: 5, isSession: true }, { id: 40, label: '7-A', classObj: 7, isSession: true }];
    expect(feeClassOptions(sections, masters)).toEqual([{ id: 5, label: 'Class 5' }, { id: 7, label: 'Class 7' }]);
  });
  it('falls back to all master classes when the year has no sections', () => {
    expect(feeClassOptions([{ id: 5, label: 'Class 5', classObj: null, isSession: false }], masters)).toHaveLength(3);
  });
});

describe('validation and payload', () => {
  const rows = [
    { category: 11, amount: '2600', saved: '2500' },
    { category: 12, amount: '500', saved: '500' },
    { category: 14, amount: '300', saved: '' },
  ];
  it('re-sends only changed or new rows', () => {
    expect(changedRows(rows).map((r) => r.category)).toEqual([11, 14]);
  });
  it('needs a date, a category and a positive amount on every filled row, no duplicates, and a change', () => {
    expect(validateRows(rows, '')).toMatch(/date/);
    expect(validateRows([{ ...emptyRow(), amount: '100' }], '2026-11-01')).toMatch(/category/);
    expect(validateRows([{ category: 1, amount: '0', saved: '' }], '2026-11-01')).toMatch(/above zero/);
    expect(validateRows([{ category: 1, amount: 'abc', saved: '' }], '2026-11-01')).toMatch(/above zero/);
    expect(validateRows([{ category: 1, amount: '5', saved: '' }, { category: 1, amount: '6', saved: '' }], '2026-11-01')).toMatch(/twice/);
    expect(validateRows([{ category: 1, amount: '5', saved: '5' }], '2026-11-01')).toMatch(/Nothing has changed/);
    expect(validateRows(rows, '2026-11-01')).toBeNull();
  });
  it('ignores an empty placeholder row', () => {
    expect(validateRows([{ category: 1, amount: '7', saved: '' }, emptyRow()], '2026-11-01')).toBeNull();
  });
  it('builds the bulk payload with the right category field per kind', () => {
    expect(buildFeePayload(5, 'MONTHLY', rows, '2026-11-01', 3)).toEqual({
      structures: [
        { class_obj: 5, fee_type: 'MONTHLY', monthly_category: 11, monthly_amount: 2600 },
        { class_obj: 5, fee_type: 'MONTHLY', monthly_category: 14, monthly_amount: 300 },
      ],
      effective_from: '2026-11-01', academic_year: 3,
    });
    expect(buildFeePayload(5, 'ANNUAL', [{ category: 3, amount: '12000', saved: '' }], '2026-11-01')).toEqual({
      structures: [{ class_obj: 5, fee_type: 'ANNUAL', annual_category: 3, monthly_amount: 12000 }], effective_from: '2026-11-01',
    });
  });
  it('totals and summarises', () => {
    expect(totalOf(rows)).toBe(3400);
    expect(changeSummary('Class 5', rows, '2026-11-01', { 11: 'Tuition', 14: 'Lab' })).toBe(
      'Class 5, from 2026-11-01\nTuition: 2,500 → 2,600\nLab: new, 300');
  });
});
