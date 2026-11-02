import fs from 'fs';
import path from 'path';
import { groupIcon, hasGroupIcon, hasItemIcon, itemIcon } from '../navigation/navIcons';

const source = fs.readFileSync(path.join(__dirname, '../navigation/navConfig.ts'), 'utf8');

describe('menu icons', () => {
  it('has an icon for every menu entry in navConfig.ts', () => {
    const paths = [...source.matchAll(/item\('[^']*',\s*'([^']+)'/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(50);
    expect(paths.filter((p) => !hasItemIcon(p))).toEqual([]);
  });

  it('has an icon for every group name in navConfig.ts', () => {
    const names = [...source.matchAll(/name: '([^']+)',\s*items/g)].map((m) => m[1]);
    const grouped = [...source.matchAll(/name: '([^']+)',\s*\n\s*items/g)].map((m) => m[1]);
    const used = [...new Set([...names, ...grouped])];
    expect(used.length).toBeGreaterThan(3);
    expect(used.filter((n) => !hasGroupIcon(n))).toEqual([]);
  });

  it('falls back to a plain dot for anything unknown', () => {
    expect(itemIcon('/nope')).toBe('ellipse-outline');
    expect(groupIcon('Nope')).toBe('ellipse-outline');
    expect(itemIcon('/dashboard')).toBe('home-outline');
  });
});
