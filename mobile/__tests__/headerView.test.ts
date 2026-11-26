import { backTarget, shortYearLabel } from '../services/headerView';

describe('backTarget', () => {
  it('goes back when there is history, else to the role Home', () => {
    expect(backTarget(true, 'teacher')).toBe('back');
    expect(backTarget(false, 'teacher')).toBe('/(teacher)/dashboard');
    expect(backTarget(false, 'parent')).toBe('/(parent)/dashboard');
  });
});

describe('shortYearLabel', () => {
  it('shortens a year range and drops any prefix', () => {
    expect(shortYearLabel('2025-2026')).toBe('2025-26');
    expect(shortYearLabel('SEED_TEST_2025-2026')).toBe('2025-26');
    expect(shortYearLabel('Session 2025 – 2026')).toBe('2025-26');
    expect(shortYearLabel('2025-26')).toBe('2025-26');
  });
  it('keeps a name without a year range', () => {
    expect(shortYearLabel('Spring term')).toBe('Spring term');
    expect(shortYearLabel('')).toBe('');
  });
});
