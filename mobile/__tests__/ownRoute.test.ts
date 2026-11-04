import { ownRouteForPath } from '../navigation/routes';

describe('ownRouteForPath', () => {
  it('finds the persona\'s own copy of a path that names no group', () => {
    expect(ownRouteForPath('teacher', '/paper-builder')).toBe('/(teacher)/paper-builder');
    expect(ownRouteForPath('admin', '/paper-builder')).toBe('/(admin)/paper-builder');
  });
  it('always allows the dashboard', () => {
    expect(ownRouteForPath('parent', '/dashboard')).toBe('/(parent)/dashboard');
  });
  it('returns nothing for a screen the persona does not have', () => {
    expect(ownRouteForPath('parent', '/paper-builder')).toBeUndefined();
    expect(ownRouteForPath('teacher', '/nope')).toBeUndefined();
  });
});
