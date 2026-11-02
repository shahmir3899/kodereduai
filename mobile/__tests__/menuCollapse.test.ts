jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return { __esModule: true, default: { getItem: jest.fn(async (k: string) => store[k] ?? null), setItem: jest.fn(async (k: string, v: string) => { store[k] = v; }) } };
});

import { containsPath, isGroupOpen, loadOverrides, plainPath, saveOverrides, toggleGroup } from '../services/menuCollapse';
import type { NavGroup } from '../navigation/navConfig';

const item = (n: string, href?: string) => ({ name: n, webPath: `/${n}`, href });
const finance: NavGroup = { name: 'Finance', items: [item('a', '/(admin)/finance'), item('b', '/(admin)/finance/accounts'), item('c', '/(admin)/finance/income')] };
const general: NavGroup = { name: 'General', items: [item('d', '/(admin)/dashboard'), item('e')] };

describe('plainPath and containsPath', () => {
  it('drops the route group so it matches the address', () => {
    expect(plainPath('/(admin)/finance/accounts')).toBe('/finance/accounts');
    expect(plainPath('/(admin)')).toBe('/');
  });
  it('matches the exact screen or one below it, and ignores entries without a screen', () => {
    expect(containsPath(finance, '/finance/accounts')).toBe(true);
    expect(containsPath(finance, '/finance/accounts/12')).toBe(true);
    expect(containsPath(finance, '/students')).toBe(false);
    expect(containsPath({ name: 'X', items: [item('z')] }, '/z')).toBe(false);
  });
});

describe('isGroupOpen', () => {
  it('is closed by default, open when it holds the current screen or is small', () => {
    expect(isGroupOpen(finance, {}, '/students', false)).toBe(false);
    expect(isGroupOpen(finance, {}, '/finance/income', false)).toBe(true);
    expect(isGroupOpen(general, {}, '/students', false)).toBe(true);
  });
  it('follows the person over the default, and searching opens everything', () => {
    expect(isGroupOpen(finance, { Finance: true }, '/students', false)).toBe(true);
    expect(isGroupOpen(finance, { Finance: false }, '/finance', false)).toBe(false);
    expect(isGroupOpen(finance, { Finance: false }, '/students', true)).toBe(true);
  });
});

describe('toggleGroup', () => {
  it('flips what is shown now, including a default', () => {
    expect(toggleGroup({}, finance, '/students')).toEqual({ Finance: true });
    expect(toggleGroup({}, finance, '/finance')).toEqual({ Finance: false });
    expect(toggleGroup({ Finance: true }, finance, '/students')).toEqual({ Finance: false });
  });
});

describe('storage', () => {
  it('keeps choices per person and school and ignores bad data', async () => {
    await saveOverrides(1, 42, { Finance: true });
    expect(await loadOverrides(1, 42)).toEqual({ Finance: true });
    expect(await loadOverrides(2, 42)).toEqual({});
    await require('@react-native-async-storage/async-storage').default.setItem('menuCollapse:3:42', '{"A":true,"B":"x"}');
    expect(await loadOverrides(3, 42)).toEqual({ A: true });
    await require('@react-native-async-storage/async-storage').default.setItem('menuCollapse:4:42', '[1]');
    expect(await loadOverrides(4, 42)).toEqual({});
  });
});
