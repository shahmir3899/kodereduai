// Aura's answers are plain text, but lists of students or amounts come back as markdown tables.
// Only that one shape is drawn as a real table; everything else stays as written, so nothing is lost.
const isRow = (line) => /^\s*\|.*\|\s*$/.test(line)
const isRule = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)
const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())

export function splitBlocks(text) {
  const lines = String(text ?? '').split('\n')
  const blocks = []
  let para = []
  const flush = () => {
    if (para.length) { blocks.push({ type: 'text', text: para.join('\n') }); para = [] }
  }
  for (let i = 0; i < lines.length; i += 1) {
    if (isRow(lines[i]) && i + 1 < lines.length && isRule(lines[i + 1])) {
      const head = cells(lines[i])
      const rows = []
      let j = i + 2
      while (j < lines.length && isRow(lines[j])) { rows.push(cells(lines[j])); j += 1 }
      flush()
      blocks.push({ type: 'table', head, rows })
      i = j - 1
    } else {
      para.push(lines[i])
    }
  }
  flush()
  return blocks
}

const numeric = (v) => /^[\s\-+]?[\d,.]+\s*%?$/.test(v)

export default function RichText({ text }) {
  const blocks = splitBlocks(text)
  if (!blocks.some((b) => b.type === 'table')) return text
  return blocks.map((b, i) => {
    if (b.type === 'text') {
      return b.text.trim() ? <span key={i} className="block whitespace-pre-wrap">{b.text.replace(/^\n+|\n+$/g, '')}</span> : null
    }
    return (
      <div key={i} className="my-1 max-w-full overflow-x-auto">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr>{b.head.map((h, k) => <th key={k} scope="col" className="border-b border-slate-300 px-2 py-1 text-left font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {b.rows.map((r, k) => (
              <tr key={k}>
                {b.head.map((_, c) => (
                  <td key={c} dir="auto" className={`border-b border-slate-200 px-2 py-1 ${numeric(r[c] ?? '') ? 'text-right tabular-nums' : ''}`}>{r[c] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  })
}
