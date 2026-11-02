import {
  coverageSummary, dateAtFraction, findGaps, findOverlaps, monthSpans, moveEdge, stepEdge, termDays,
} from '../services/yearTimeline';

const y = { start_date: '2025-08-01', end_date: '2025-08-10' }; // ten days

describe('gaps and overlaps', () => {
  it('finds gaps', () => {
    expect(findGaps([], y.start_date, y.end_date)).toEqual([{ start_date: '2025-08-01', end_date: '2025-08-10', days: 10 }]);
    expect(findGaps([{ start_date: '2025-08-01', end_date: '2025-08-05' }, { start_date: '2025-08-06', end_date: '2025-08-10' }], y.start_date, y.end_date)).toEqual([]);
    expect(findGaps([{ start_date: '2025-08-03', end_date: '2025-08-04' }], y.start_date, y.end_date).map((g) => g.days)).toEqual([2, 6]);
  });
  it('finds overlaps, not touching terms', () => {
    const a = { id: 1, start_date: '2025-08-01', end_date: '2025-08-05' };
    expect([...findOverlaps([a, { id: 2, start_date: '2025-08-05', end_date: '2025-08-09' }])]).toEqual([]);
    expect([...findOverlaps([a, { id: 2, start_date: '2025-08-04', end_date: '2025-08-09' }])].sort()).toEqual([1, 2]);
    expect(termDays(a)).toBe(5);
  });
});

describe('month boxes', () => {
  it('clips to the year', () => {
    const m = monthSpans('2025-08-15', '2025-10-10');
    expect(m.map((s) => s.label)).toEqual(['Aug', 'Sep', 'Oct']);
    expect(m[0]).toMatchObject({ start_date: '2025-08-15', end_date: '2025-08-31' });
    expect(m[2]).toMatchObject({ start_date: '2025-10-01', end_date: '2025-10-10' });
    expect(monthSpans('2025-12-01', '2026-01-31').map((s) => s.label)).toEqual(['Dec', 'Jan']);
  });
});

describe('dragging', () => {
  it('maps a position on the bar to a day for each handle', () => {
    expect(dateAtFraction(0, y, 'start')).toBe('2025-08-01');
    expect(dateAtFraction(0.5, y, 'start')).toBe('2025-08-06');
    expect(dateAtFraction(1, y, 'start')).toBe('2025-08-10');
    expect(dateAtFraction(0.5, y, 'end')).toBe('2025-08-05');
    expect(dateAtFraction(1, y, 'end')).toBe('2025-08-10');
    expect(dateAtFraction(0, y, 'end')).toBe('2025-08-01');
    expect(dateAtFraction(-3, y, 'start')).toBe('2025-08-01');
  });
  it('snaps edges inside the year and never lets them cross', () => {
    const r = { start_date: '2025-08-03', end_date: '2025-08-07' };
    expect(moveEdge(r, 'start', '2025-07-01', y)).toEqual({ start_date: '2025-08-01', end_date: '2025-08-07' });
    expect(moveEdge(r, 'start', '2025-08-09', y)).toEqual({ start_date: '2025-08-06', end_date: '2025-08-07' });
    expect(moveEdge(r, 'end', '2025-09-01', y)).toEqual({ start_date: '2025-08-03', end_date: '2025-08-10' });
    expect(moveEdge(r, 'end', '2025-08-01', y)).toEqual({ start_date: '2025-08-03', end_date: '2025-08-04' });
    expect(stepEdge(r, 'end', 1, y).end_date).toBe('2025-08-08');
    expect(stepEdge(r, 'start', -7, y).start_date).toBe('2025-08-01');
  });
});

describe('coverage summary', () => {
  it('says what is left to cover', () => {
    expect(coverageSummary(y, [])).toBe('0 terms · 10 days not covered by a term');
    expect(coverageSummary(y, [{ id: 1, start_date: '2025-08-01', end_date: '2025-08-05' }])).toBe('1 term · 5 days not covered by a term');
    expect(coverageSummary(y, [{ id: 1, start_date: '2025-08-01', end_date: '2025-08-05' }, { id: 2, start_date: '2025-08-06', end_date: '2025-08-10' }])).toBe('2 terms · every day covered');
    expect(coverageSummary(y, [{ id: 1, start_date: '2025-08-01', end_date: '2025-08-06' }, { id: 2, start_date: '2025-08-05', end_date: '2025-08-10' }])).toMatch(/terms overlap/);
  });
});
