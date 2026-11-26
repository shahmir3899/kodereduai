import { greetingFor, pctTone, splitTiles } from '../services/homeHero';

describe('greetingFor', () => {
  it('follows the time of day', () => {
    expect(greetingFor(6)).toBe('Good morning');
    expect(greetingFor(11)).toBe('Good morning');
    expect(greetingFor(12)).toBe('Good afternoon');
    expect(greetingFor(16)).toBe('Good afternoon');
    expect(greetingFor(17)).toBe('Good evening');
    expect(greetingFor(23)).toBe('Good evening');
  });
});

describe('splitTiles', () => {
  const t = (label: string) => ({ label, value: 1 });
  it('puts the first figures in the banner and the rest in the grid', () => {
    const { hero, rest } = splitTiles([t('a'), t('b'), t('c'), t('d'), t('e')]);
    expect(hero.map((x) => x.label)).toEqual(['a', 'b', 'c']);
    expect(rest.map((x) => x.label)).toEqual(['d', 'e']);
  });
  it('handles fewer tiles than the banner holds', () => {
    expect(splitTiles([t('a')])).toEqual({ hero: [t('a')], rest: [] });
    expect(splitTiles([])).toEqual({ hero: [], rest: [] });
  });
});

describe('pctTone', () => {
  it('grades a percentage', () => {
    expect(pctTone(92)).toBe('good');
    expect(pctTone(85)).toBe('good');
    expect(pctTone(75)).toBe('warn');
    expect(pctTone(50)).toBe('bad');
    expect(pctTone(null)).toBeUndefined();
  });
});

import { parentFigures } from '../services/homeHero';

describe('parentFigures', () => {
  const o = (rate: number | null, owed: string | number) => ({ attendance_summary: { attendance_rate: rate }, fee_summary: { outstanding: owed } });
  it('sums fees owed and averages attendance across children', () => {
    expect(parentFigures([o(88, '3000.00'), o(92, 3000)])).toEqual({ feesDue: 6000, attendance: 90 });
  });
  it('ignores children not loaded yet and missing rates', () => {
    expect(parentFigures([undefined, o(null, '0')])).toEqual({ feesDue: 0, attendance: null });
  });
  it('is null while nothing has loaded', () => {
    expect(parentFigures([undefined])).toEqual({ feesDue: null, attendance: null });
    expect(parentFigures([])).toEqual({ feesDue: null, attendance: null });
  });
});
