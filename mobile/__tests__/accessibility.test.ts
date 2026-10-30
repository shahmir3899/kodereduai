import fs from 'fs';
import path from 'path';

// A touchable with no role is announced by a screen reader as plain text, not as something you can
// tap. File-level on purpose: it catches a new screen that forgets roles altogether.
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return p.endsWith('.tsx') ? [p] : [];
  });
}

describe('accessibility', () => {
  const root = path.join(__dirname, '..');
  const files = [...sourceFiles(path.join(root, 'app')), ...sourceFiles(path.join(root, 'components'))];

  it('gives every file that uses TouchableOpacity an accessibilityRole', () => {
    const missing = files
      .filter((f) => {
        const s = fs.readFileSync(f, 'utf8');
        return s.includes('<TouchableOpacity') && !s.includes('accessibilityRole');
      })
      .map((f) => path.relative(root, f));
    expect(missing).toEqual([]);
  });
});
