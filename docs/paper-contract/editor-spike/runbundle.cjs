const { JSDOM } = require('jsdom'); const fs = require('fs')
const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true })
dom.window.eval(fs.readFileSync('entry.min.js', 'utf8'))
const cases = JSON.parse(fs.readFileSync('cases.json', 'utf8')); const ref = JSON.parse(fs.readFileSync('v2.out.json', 'utf8'))
let same = 0
for (const c of cases) {
  const el = dom.window.document.createElement('div'); dom.window.document.body.appendChild(el)
  const ed = dom.window.createEditor(el, c.html, () => {})
  const html = ed.getHTML(); ed.destroy()
  if (html === ref[c.name]) same++; else console.log('DIFF', c.name, html.slice(0, 100))
}
console.log(`bundle in a plain browser page vs web editor output: ${same}/${cases.length} identical`)
