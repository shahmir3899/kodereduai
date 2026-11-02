import { insightList, insightsToggleLabel, insightTone, moduleLabel, visibleInsights } from '../services/aiInsights';

const make = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `T${i}` }));

describe('insightList', () => {
  it('reads the insights and drops entries without a title', () => {
    expect(insightList({ insights: [{ title: 'Low attendance' }, { title: ' ' }, { detail: 'x' }, null] })).toEqual([{ title: 'Low attendance' }]);
  });

  it('is empty for anything else', () => {
    expect(insightList(undefined)).toEqual([]);
    expect(insightList({})).toEqual([]);
    expect(insightList({ insights: 'no' })).toEqual([]);
  });
});

describe('tone and labels', () => {
  it('maps the type to a tone, info by default', () => {
    expect(insightTone('alert')).toBe('error');
    expect(insightTone('warning')).toBe('warning');
    expect(insightTone('info')).toBe('info');
    expect(insightTone(undefined)).toBe('info');
  });

  it('capitalises the module', () => {
    expect(moduleLabel('finance')).toBe('Finance');
    expect(moduleLabel(null)).toBe('');
  });
});

describe('showing a few at a time', () => {
  it('shows three, or all when expanded', () => {
    expect(visibleInsights(make(5), false)).toHaveLength(3);
    expect(visibleInsights(make(5), true)).toHaveLength(5);
  });

  it('offers the toggle only when there is more than three', () => {
    expect(insightsToggleLabel(3, false)).toBeNull();
    expect(insightsToggleLabel(5, false)).toBe('Show all (5)');
    expect(insightsToggleLabel(5, true)).toBe('Show less');
  });
});

import { netPayTrend, trendNote } from '../services/payroll';

describe('net pay trend', () => {
  const data = {
    periods: [{ month: 9, year: 2026 }, { month: 10, year: 2026 }, { month: 11, year: 2026 }],
    history: { '7': [{ month: 9, year: 2026, net_salary: '40000' }, { month: 11, year: 2026, net_salary: 50000 }] },
  };

  it('has one bar per period, scaled to the biggest, with no bar for a month without a payslip', () => {
    const bars = netPayTrend(data, 7);
    expect(bars.map((b) => b.label)).toEqual(['Sep', 'Oct', 'Nov']);
    expect(bars.map((b) => b.value)).toEqual([40000, null, 50000]);
    expect(bars.map((b) => b.ratio)).toEqual([0.8, 0, 1]);
  });

  it('is empty without data and all empty bars for someone with no payslips', () => {
    expect(netPayTrend(null, 7)).toEqual([]);
    expect(netPayTrend(data, 99).every((b) => b.value == null)).toBe(true);
  });

  it('says how the last month compares with the one before it', () => {
    expect(trendNote(netPayTrend(data, 7))).toBe('Up 25% from Sep');
    expect(trendNote(netPayTrend({ periods: [{ month: 10, year: 2026 }, { month: 11, year: 2026 }], history: { '7': [{ month: 10, year: 2026, net_salary: 50000 }, { month: 11, year: 2026, net_salary: 48000 }] } }, 7))).toBe('Down 4% from Oct');
    expect(trendNote(netPayTrend({ periods: [{ month: 11, year: 2026 }], history: { '7': [{ month: 11, year: 2026, net_salary: 1 }] } }, 7))).toBeNull();
  });
});
