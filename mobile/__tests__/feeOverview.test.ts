import { categoryRows, chartBars, classRows, collectionRate, hasOverview, overviewParams } from '../services/feeOverview';

const data = {
  by_category: [
    { category_id: 1, category_name: 'Tuition Fee', total_due: '100000.00', total_collected: '60000.00', count: 12 },
    { category_id: 2, category_name: null, total_due: 5000, total_collected: 5500, count: 2 },
  ],
  by_class: [{ class_name: 'Grade 1 - A', students: 4, total_due: '34400', total_collected: '17150' }],
};

describe('rows', () => {
  it('works out collected, pending and the rate for each category, with a name for an unnamed one', () => {
    const rows = categoryRows(data);
    expect(rows[0]).toEqual({ label: 'Tuition Fee', due: 100000, collected: 60000, pending: 40000, rate: 60, count: 12 });
    expect(rows[1]).toMatchObject({ label: 'Uncategorized', pending: 0, rate: 100 });
  });

  it('does the same by class', () => {
    expect(classRows(data)[0]).toEqual({ label: 'Grade 1 - A', due: 34400, collected: 17150, pending: 17250, rate: 50, count: 4 });
  });

  it('copes with no data', () => {
    expect(categoryRows(null)).toEqual([]);
    expect(classRows({})).toEqual([]);
    expect(hasOverview(undefined)).toBe(false);
    expect(hasOverview(data)).toBe(true);
  });
});

describe('collectionRate', () => {
  it('is zero with nothing due and never above 100', () => {
    expect(collectionRate(0, 500)).toBe(0);
    expect(collectionRate(100, 250)).toBe(100);
    expect(collectionRate(200, 50)).toBe(25);
  });
});

describe('chartBars', () => {
  it('makes one stacked bar per row, collected then pending, with a short label', () => {
    const bars = chartBars([{ label: 'A very long category name', due: 10, collected: 4, pending: 6, rate: 40, count: 1 }]);
    expect(bars[0].label).toBe('A very lo…');
    expect(bars[0].stacks.map((s) => s.value)).toEqual([4, 6]);
  });
});

describe('overviewParams', () => {
  it('asks for monthly fees of the month, with the academic year when known', () => {
    expect(overviewParams(11, 2026, 46)).toEqual({ month: 11, year: 2026, fee_type: 'MONTHLY', academic_year: 46 });
    expect(overviewParams(11, 2026, null)).toEqual({ month: 11, year: 2026, fee_type: 'MONTHLY' });
  });
});
