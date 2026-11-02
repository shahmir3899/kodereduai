jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => store[k] ?? null),
      setItem: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    },
  };
});

import { filterGroups } from '../services/menuSearch';
import { addRecent, EMPTY_SHORTCUTS, loadShortcuts, MAX_PINS, MAX_RECENTS, resolveShortcuts, saveShortcuts, togglePin } from '../services/menuShortcuts';
import type { NavGroup } from '../navigation/navConfig';

const groups: NavGroup[] = [
  { name: 'Finance', items: [{ name: 'Collect Payments', webPath: '/f/collect', href: '/(admin)/finance/fee-collection' }, { name: 'Fee Overview', webPath: '/f/overview' }] },
  { name: 'Students', items: [{ name: 'All Students', webPath: '/s', href: '/(admin)/students' }] },
];

describe('filterGroups', () => {
  it('keeps everything for a blank query', () => {
    expect(filterGroups(groups, '  ')).toBe(groups);
  });
  it('matches every word against the entry or its group, case-insensitively', () => {
    expect(filterGroups(groups, 'COLLECT').map((g) => g.items.map((i) => i.name))).toEqual([['Collect Payments']]);
    expect(filterGroups(groups, 'finance pay')[0].items).toHaveLength(1);
  });
  it('drops groups with no match and returns nothing for no match', () => {
    expect(filterGroups(groups, 'students').map((g) => g.name)).toEqual(['Students']);
    expect(filterGroups(groups, 'zzz')).toEqual([]);
  });
});

describe('pins and recents', () => {
  it('toggles a pin and stops at the limit', () => {
    let s = togglePin(EMPTY_SHORTCUTS, 'a');
    expect(s.pins).toEqual(['a']);
    expect(togglePin(s, 'a').pins).toEqual([]);
    for (let i = 0; i < MAX_PINS + 2; i++) s = togglePin(s, `p${i}`);
    expect(s.pins).toHaveLength(MAX_PINS);
  });
  it('puts the newest recent first without repeats, capped', () => {
    let s = EMPTY_SHORTCUTS;
    for (const p of ['a', 'b', 'c', 'd', 'e', 'c']) s = addRecent(s, p);
    expect(s.recents).toEqual(['c', 'e', 'd', 'b']);
    expect(s.recents).toHaveLength(MAX_RECENTS);
  });
  it('shows pins first, recents without the pinned ones, and drops entries that cannot be opened', () => {
    const r = resolveShortcuts(groups, { pins: ['/s', '/gone'], recents: ['/s', '/f/overview', '/f/collect'] });
    expect(r.pins.map((i) => i.name)).toEqual(['All Students']);
    expect(r.recents.map((i) => i.name)).toEqual(['Collect Payments']);
  });
});

describe('storage', () => {
  it('saves and loads per person and school, and copes with bad data', async () => {
    await saveShortcuts(1, 42, { pins: ['a'], recents: ['b'] });
    expect(await loadShortcuts(1, 42)).toEqual({ pins: ['a'], recents: ['b'] });
    expect(await loadShortcuts(2, 42)).toEqual(EMPTY_SHORTCUTS);
    await (require('@react-native-async-storage/async-storage').default.setItem)('menuShortcuts:3:42', '{oops');
    expect(await loadShortcuts(3, 42)).toEqual(EMPTY_SHORTCUTS);
  });
});
