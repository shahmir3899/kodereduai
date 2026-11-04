const { JSDOM } = require('jsdom')
const dom = new JSDOM('<!doctype html><html><body><div id="e"></div></body></html>', { pretendToBeVisual: true })
for (const k of ['window','document','navigator','Node','Element','HTMLElement','DOMParser','MutationObserver','getComputedStyle','Range','Text','Selection','ClipboardEvent','DocumentFragment']) { try { globalThis[k] = dom.window[k] } catch {} }
globalThis.document = dom.window.document
import fs from 'node:fs'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import * as MathNS from '@aarkue/tiptap-math-extension'
const MathExtension = (MathNS.default && MathNS.default.configure) ? MathNS.default : (MathNS.MathExtension || (MathNS.default && MathNS.default.default) || MathNS.default)
const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const out = {}
for (const c of cases) {
  const el = dom.window.document.createElement('div'); dom.window.document.body.appendChild(el)
  const ed = new Editor({ element: el, extensions: [StarterKit, Subscript, Superscript, Table.configure({ resizable: true }), TableRow, TableHeader, TableCell, MathExtension.configure({ evaluation: false })], content: c.html })
  out[c.name] = ed.getHTML(); ed.destroy()
}
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1))
console.log('v2 done', Object.keys(out).length)
