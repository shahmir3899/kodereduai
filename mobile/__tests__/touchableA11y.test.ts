import fs from 'fs';
import path from 'path';

// Every tappable element needs a role, and a button that shows only a symbol (‹ × + and so on)
// needs a spoken label, or a screen reader says nothing useful. The older test checks per file;
// this one checks each element, so one forgotten button in a file that has others is caught too.
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return p.endsWith('.tsx') ? [p] : [];
  });
}

interface Touchable { file: string; line: number; open: string; body: string }

// Opening tag up to its closing `>` (braces tracked, so `=>` and `{a > b}` do not end it), plus the
// text up to the matching close tag.
function touchables(file: string, src: string): Touchable[] {
  const out: Touchable[] = [];
  const re = /<(TouchableOpacity|Pressable|TouchableHighlight)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length; let depth = 0; let quote = '';
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) { if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0 && src[i - 1] !== '=') break;
    }
    const open = src.slice(m.index, i + 1);
    const selfClosing = src[i - 1] === '/';
    const end = selfClosing ? i + 1 : src.indexOf(`</${m[1]}>`, i);
    out.push({ file, line: src.slice(0, m.index).split('\n').length, open, body: selfClosing ? '' : src.slice(i + 1, end < 0 ? i + 1 : end) });
  }
  return out;
}

const root = path.join(__dirname, '..');
const all = [...sourceFiles(path.join(root, 'app')), ...sourceFiles(path.join(root, 'components'))]
  .flatMap((f) => touchables(path.relative(root, f), fs.readFileSync(f, 'utf8')));

// What the button shows, when that is a single symbol.
const SYMBOL = /^[‹›×✕✖+\-−←→↑↓✓✔☰⋮…<>«»≡▾▴▼▲⟳↻]$/;
function symbolOnly(body: string): boolean {
  // Any `{...}` child is real content (a title, a count), so the button already has words.
  if (/\{/.test(body.replace(/style=\{[^}]*\}/g, ''))) return false;
  const text = body.replace(/<[^>]*>/g, '').replace(/\s+/g, '');
  return text.length > 0 && text.length <= 2 && SYMBOL.test(text.replace(/️/g, ''));
}

describe('touchables', () => {
  it('finds the touchables', () => {
    expect(all.length).toBeGreaterThan(100);
  });

  it('gives every tappable element an accessibilityRole', () => {
    expect(all.filter((t) => !t.open.includes('accessibilityRole') && !t.open.includes('accessible={false}')).map((t) => `${t.file}:${t.line}`)).toEqual([]);
  });

  it('gives every symbol-only button an accessibilityLabel', () => {
    expect(all.filter((t) => symbolOnly(t.body) && !t.open.includes('accessibilityLabel')).map((t) => `${t.file}:${t.line}`)).toEqual([]);
  });
});
