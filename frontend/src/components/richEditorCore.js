// The one definition of the question-text editor, shared by the web editor (RichTextEditor.jsx) and the bundle that
// the mobile app runs in a WebView (scripts/build-rich-editor.mjs -> mobile/assets/richEditorHtml.ts). Same extensions
// from the same packages, so both write byte-identical HTML. Keep this file free of React and the DOM.
import StarterKit from '@tiptap/starter-kit'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import * as MathNS from '@aarkue/tiptap-math-extension'

// The package's default export is the extension itself in the ESM build and sits one level down in the CJS build.
const MathExtension = (MathNS.default && MathNS.default.configure) ? MathNS.default : MathNS.MathExtension

export function createExtensions() {
  return [
    StarterKit,
    Subscript,
    Superscript,
    // Kept so underline and links in a question (pasted, or written elsewhere) survive loading. Links are not made while typing
    // or pasting, and a click in the editor does not follow them.
    Underline,
    Link.configure({ openOnClick: false, autolink: false, linkOnPaste: false }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    MathExtension.configure({ evaluation: false }),
  ]
}

const RTL_LANGUAGES = new Set(['ur', 'ar', 'sd', 'ps'])

export function isRTLLanguage(langCode) {
  return RTL_LANGUAGES.has(langCode)
}

// Question text is saved as a single HTML string, so language/direction travels inside it: wrapped in a
// `<div dir=".." lang="..">` shell on save and unwrapped again on load (same dir/font-rtl convention as RTLWrapper.jsx).
export const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'ur', label: 'اردو (Urdu)' },
  { code: 'ar', label: 'العربية (Arabic)' },
  { code: 'ps', label: 'پښتو (Pashto)' },
  { code: 'sd', label: 'سنڌي (Sindhi)' },
]

const WRAPPER_RE = /^<div dir="(ltr|rtl)"(?: lang="([a-z]{2})")?[^>]*>([\s\S]*)<\/div>$/i

export function unwrapLanguage(html) {
  if (!html) return { language: 'en', inner: '' }
  const match = html.match(WRAPPER_RE)
  if (match) return { language: match[2] || (match[1] === 'rtl' ? 'ur' : 'en'), inner: match[3] }
  return { language: 'en', inner: html }
}

export function wrapLanguage(innerHtml, language) {
  const rtl = isRTLLanguage(language)
  return `<div dir="${rtl ? 'rtl' : 'ltr'}" lang="${language}" class="${rtl ? 'font-rtl' : ''}">${innerHtml}</div>`
}

// Toolbar commands by name, for the mobile toolbar (the web toolbar calls the same chains from its own buttons).
export const EDITOR_COMMANDS = {
  undo: (e) => e.chain().focus().undo().run(),
  redo: (e) => e.chain().focus().redo().run(),
  bold: (e) => e.chain().focus().toggleBold().run(),
  italic: (e) => e.chain().focus().toggleItalic().run(),
  strike: (e) => e.chain().focus().toggleStrike().run(),
  underline: (e) => e.chain().focus().toggleUnderline().run(),
  subscript: (e) => e.chain().focus().toggleSubscript().run(),
  superscript: (e) => e.chain().focus().toggleSuperscript().run(),
  heading1: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  heading2: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  bulletList: (e) => e.chain().focus().toggleBulletList().run(),
  orderedList: (e) => e.chain().focus().toggleOrderedList().run(),
  insertTable: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  addColumn: (e) => e.chain().focus().addColumnAfter().run(),
  addRow: (e) => e.chain().focus().addRowAfter().run(),
  deleteTable: (e) => e.chain().focus().deleteTable().run(),
  equation: (e) => {
    const from = e.state.selection.from
    e.chain().focus().insertContent('$x$').run()
    // Select the placeholder "x" so it can be typed over with real LaTeX.
    e.chain().setTextSelection({ from: from + 1, to: from + 2 }).run()
  },
  clear: (e) => e.chain().focus().unsetAllMarks().clearNodes().run(),
}

export function activeFlags(e) {
  return {
    bold: e.isActive('bold'), italic: e.isActive('italic'), strike: e.isActive('strike'), underline: e.isActive('underline'),
    subscript: e.isActive('subscript'), superscript: e.isActive('superscript'),
    heading1: e.isActive('heading', { level: 1 }), heading2: e.isActive('heading', { level: 2 }),
    bulletList: e.isActive('bulletList'), orderedList: e.isActive('orderedList'), inTable: e.isActive('table'),
  }
}
