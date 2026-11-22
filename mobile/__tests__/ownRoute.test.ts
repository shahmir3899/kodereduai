import fs from 'fs';
import path from 'path';
import { LINKED_SCREENS, nextWithQuery, ownRouteForPath, ownTargetForNext } from '../navigation/routes';

describe('links with a query', () => {
  it('keeps the query in next', () => {
    expect(nextWithQuery('/paper-builder', { id: '16' })).toBe('/paper-builder?id=16');
    expect(nextWithQuery('/paper-builder', {})).toBe('/paper-builder');
    expect(nextWithQuery('/x', { a: ['1', '2'], next: '/old', b: undefined })).toBe('/x?a=1&a=2');
    expect(nextWithQuery('/x', { q: 'a b&c' })).toBe('/x?q=a+b%26c');
  });
  it('opens the own copy of the screen with the same query', () => {
    expect(ownTargetForNext('teacher', '/paper-builder?id=16')).toEqual({ pathname: '/(teacher)/paper-builder', params: { id: '16' } });
    expect(ownTargetForNext('manager', nextWithQuery('/paper-builder', { id: '16' })))
      .toEqual({ pathname: '/(manager)/paper-builder', params: { id: '16' } });
    expect(ownTargetForNext('admin', '/paper-builder')).toEqual({ pathname: '/(admin)/paper-builder', params: {} });
  });
  it('still refuses a screen outside the own group, query or not', () => {
    expect(ownTargetForNext('parent', '/paper-builder?id=16')).toBeUndefined();
    expect(ownTargetForNext('teacher', '/(admin)/paper-builder?id=16')).toBeUndefined();
  });
});

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

describe('screens opened from a list keep working as links', () => {
  it('opens the own worksheet builder of the persona, with its id', () => {
    expect(ownTargetForNext('manager', '/worksheet-builder?id=1')).toEqual({ pathname: '/(manager)/worksheet-builder', params: { id: '1' } });
    expect(ownTargetForNext('teacher', nextWithQuery('/worksheet-builder', { id: '7' })))
      .toEqual({ pathname: '/(teacher)/worksheet-builder', params: { id: '7' } });
    expect(ownRouteForPath('admin', '/curriculum/book')).toBe('/(admin)/curriculum/book');
  });

  it('never opens a screen the persona does not have', () => {
    expect(ownTargetForNext('parent', '/worksheet-builder?id=1')).toBeUndefined();
    expect(ownRouteForPath('manager', '/date-sheet')).toBeUndefined();
  });

  it('every listed screen exists in the group of that persona', () => {
    const appDir = path.join(__dirname, '..', 'app');
    Object.entries(LINKED_SCREENS).forEach(([persona, screens]) => {
      (screens ?? []).forEach((screen) => {
        const base = path.join(appDir, `(${persona})${screen}`);
        expect([base + '.tsx', path.join(base, 'index.tsx')].some((f) => fs.existsSync(f))).toBe(true);
      });
    });
  });
});
