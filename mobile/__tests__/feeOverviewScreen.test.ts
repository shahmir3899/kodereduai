import { groupByClass, overviewKpis, pendingStudents, screenParams, statusSlices } from '../services/feeOverview';

const fee = (id: number, cls: string, roll: string, status: 'UNPAID' | 'PARTIAL' | 'PAID', due: number, paid: number) =>
  ({ id, student: id, student_name: `S${id}`, student_roll: roll, class_name: cls, status, amount_due: due, amount_paid: paid });

describe('fee overview screen', () => {
  it('asks for annual fees in month 0 with the annual category, monthly with the monthly one', () => {
    const base = { month: 11, year: 2026, academicYearId: 4, categoryId: 9 };
    expect(screenParams({ ...base, feeType: 'ANNUAL' })).toEqual({ month: 0, year: 2026, fee_type: 'ANNUAL', annual_category: 9, academic_year: 4 });
    expect(screenParams({ ...base, feeType: 'MONTHLY', categoryId: null, academicYearId: null })).toEqual({ month: 11, year: 2026, fee_type: 'MONTHLY' });
  });

  it('totals and rate, without dividing by zero', () => {
    expect(overviewKpis({ total_students: 3, total_due: '1000', total_collected: 250 })).toEqual({ students: 3, due: 1000, collected: 250, balance: 750, rate: 25 });
    expect(overviewKpis({ total_due: 0, total_collected: 0 }).rate).toBe(0);
    expect(overviewKpis(null).balance).toBe(0);
  });

  it('leaves empty slices out of the status donut', () => {
    expect(statusSlices({ paid_count: 5, unpaid_count: 2, partial_count: 0 }).map((s) => s.text)).toEqual(['Paid', 'Unpaid']);
  });

  it('groups by class in roll order and sums the balance', () => {
    const g = groupByClass([fee(1, '5A', '10', 'UNPAID', 100, 0), fee(2, '5A', '2', 'PAID', 100, 100), fee(3, '6B', '1', 'PARTIAL', 100, 40)]);
    expect(g.map((x) => x.name)).toEqual(['5A', '6B']);
    expect(g[0].rows.map((r) => r.id)).toEqual([2, 1]);
    expect(g[0].balance).toBe(100);
  });

  it('lists only students who still owe, with the total owed', () => {
    const p = pendingStudents([fee(1, '5A', '1', 'UNPAID', 100, 0), fee(2, '5A', '2', 'PAID', 100, 100), fee(3, '6B', '1', 'PARTIAL', 100, 40)]);
    expect(p).toMatchObject({ count: 2, total: 160 });
    expect(p.groups.map((x) => x.name)).toEqual(['5A', '6B']);
  });
});
