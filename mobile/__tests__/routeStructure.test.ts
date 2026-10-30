import fs from 'fs';
import path from 'path';

// A folder under a tab group with no _layout.tsx is flattened by expo-router into the parent
// navigator, so every file in it becomes its own tab button. That is how the admin tab bar grew to
// 28 extra buttons. This builds the real route tree and fails if any group has such a folder.
describe('route structure', () => {
  const root = path.join(__dirname, '..', 'app');
  const files: Record<string, { default: () => null }> = {};
  (function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) files['./' + path.relative(root, p).split(path.sep).join('/')] = { default: () => null };
    }
  })(root);

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getRoutes } = require('expo-router/build/getRoutes');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { inMemoryContext } = require('expo-router/build/testing-library/context-stubs');
  const tree = getRoutes(inMemoryContext(files), { ignoreEntryPoints: true, skipGenerated: true });
  const groups = (tree.children as Array<{ route: string; children: Array<{ route: string }> }>).filter((c) => /^\(.*\)$/.test(c.route));

  it('finds the role groups', () => {
    expect(groups.map((g) => g.route)).toContain('(admin)');
  });

  it.each(groups.map((g) => [g.route, g] as const))('%s has no folder without a layout', (_name, group) => {
    expect(group.children.map((c) => c.route).filter((r) => r.includes('/'))).toEqual([]);
  });

  // Any admin route the layout does not declare is shown as an extra tab button, and a declared name
  // with no route is a typo that hides nothing.
  it('declares every admin route in its layout', () => {
    const src = fs.readFileSync(path.join(root, '(admin)', '_layout.tsx'), 'utf8');
    const declared = new Set(Array.from(src.matchAll(/Tabs\.Screen\s+name="([^"]+)"/g)).map((m) => m[1]));
    const routes = groups.find((g) => g.route === '(admin)')!.children.map((c) => c.route);
    expect(routes.filter((r) => !declared.has(r))).toEqual([]);
    expect(Array.from(declared).filter((d) => !routes.includes(d))).toEqual([]);
  });
});
