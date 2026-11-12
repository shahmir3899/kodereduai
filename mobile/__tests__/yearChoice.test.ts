jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return { __esModule: true, default: {
    getItem: jest.fn(async (k: string) => store[k] ?? null),
    setItem: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    removeItem: jest.fn(async (k: string) => { delete store[k]; }),
  } };
});

import { canChooseYear, isPastYear, loadYearChoice, resolveYear, saveYearChoice, scopeKey, yearStore } from '../services/yearChoice';

const years = [{ id: 1, name: '2024-25' }, { id: 2, name: '2025-26', is_current: true }, { id: 3, name: '2026-27' }];

describe('canChooseYear', () => {
  it('is for admin, manager and finance manager only', () => {
    expect(['admin', 'manager', 'finance'].every((p) => canChooseYear(p as never))).toBe(true);
    expect(['teacher', 'staff', 'parent', 'student', 'driver'].some((p) => canChooseYear(p as never))).toBe(false);
  });
});

describe('resolveYear', () => {
  it('uses the chosen year, else the current one', () => {
    expect(resolveYear(years, 1, { allowed: true })?.id).toBe(1);
    expect(resolveYear(years, null, { allowed: true })?.id).toBe(2);
  });
  it('falls back when the chosen year no longer exists', () => {
    expect(resolveYear(years, 99, { allowed: true })?.id).toBe(2);
  });
  it('ignores the choice for roles that cannot choose and for locked screens', () => {
    expect(resolveYear(years, 1, { allowed: false })?.id).toBe(2);
    expect(resolveYear(years, 1, { allowed: true, lockToCurrent: true })?.id).toBe(2);
  });
  it('copes with no years', () => {
    expect(resolveYear([], 1, { allowed: true })).toBeNull();
  });
});

describe('isPastYear', () => {
  it('is true only when the viewed year is not the current one', () => {
    expect(isPastYear(years[0], years[1])).toBe(true);
    expect(isPastYear(years[1], years[1])).toBe(false);
    expect(isPastYear(null, years[1])).toBe(false);
  });
});

describe('storage and shared value', () => {
  it('keeps the choice per person and school and clears it', async () => {
    await saveYearChoice(1, 42, 3);
    expect(await loadYearChoice(1, 42)).toBe(3);
    expect(await loadYearChoice(2, 42)).toBeNull();
    await saveYearChoice(1, 42, null);
    expect(await loadYearChoice(1, 42)).toBeNull();
  });
  it('tells subscribers and only answers for its own scope', () => {
    const seen: number[] = [];
    const off = yearStore.subscribe(() => seen.push(1));
    const scope = scopeKey(1, 42);
    yearStore.set(scope, 3);
    expect(yearStore.get(scope)).toBe(3);
    expect(yearStore.get(scopeKey(1, 43))).toBeNull();
    off();
    yearStore.set(scope, null);
    expect(seen).toHaveLength(1);
  });
});
