// Aura's answers are plain text, but lists of students or amounts come back as markdown tables.
// Only that one shape is drawn as a real table; everything else stays as written, so nothing is lost.
export type Block = { type: 'text'; text: string } | { type: 'table'; head: string[]; rows: string[][] };

const isRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isRule = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function splitBlocks(text: string): Block[] {
  const lines = String(text ?? '').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) { blocks.push({ type: 'text', text: para.join('\n') }); para = []; }
  };
  for (let i = 0; i < lines.length; i += 1) {
    if (isRow(lines[i]) && i + 1 < lines.length && isRule(lines[i + 1])) {
      const head = cells(lines[i]);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && isRow(lines[j])) { rows.push(cells(lines[j])); j += 1; }
      flush();
      blocks.push({ type: 'table', head, rows });
      i = j - 1;
    } else {
      para.push(lines[i]);
    }
  }
  flush();
  return blocks;
}
