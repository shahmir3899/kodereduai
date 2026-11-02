import { weekPlanStats, weekRange } from '../services/teacherDashboard';

describe('teacher week', () => {
  it('runs Sunday to Saturday around any day, across a month end', () => {
    expect(weekRange(new Date(2026, 10, 1))).toEqual({ from: '2026-11-01', to: '2026-11-07' }); // a Sunday
    expect(weekRange(new Date(2026, 10, 4))).toEqual({ from: '2026-11-01', to: '2026-11-07' });
    expect(weekRange(new Date(2026, 10, 7))).toEqual({ from: '2026-11-01', to: '2026-11-07' }); // a Saturday
    expect(weekRange(new Date(2026, 11, 31))).toEqual({ from: '2026-12-27', to: '2027-01-02' });
  });

  it('counts done, published and draft plans, done winning over published', () => {
    const stats = weekPlanStats([
      { id: 1, status: 'COMPLETED' }, { id: 2, status: 'PUBLISHED', is_completed: true },
      { id: 3, status: 'PUBLISHED' }, { id: 4, status: 'DRAFT' }, { id: 5 },
    ]);
    expect(stats).toEqual({ total: 5, done: 2, published: 1, draft: 2 });
    expect(weekPlanStats([])).toEqual({ total: 0, done: 0, published: 0, draft: 0 });
  });
});
