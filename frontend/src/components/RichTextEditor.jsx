import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import MathExtension from '@aarkue/tiptap-math-extension'
import { useState } from 'react'
import { isRTLLanguage } from './RTLWrapper'
import DiagramCanvas from './DiagramCanvas'
import 'katex/dist/katex.min.css'

// Question text is saved as a single HTML string (see question_text in QuestionSlotEditor),
// so language/direction has to travel inside that string rather than as a separate field.
// We wrap it in a `<div dir=".." lang="..">` shell on save and unwrap it again on load —
// this keeps the wrapper in sync with the same dir/font-rtl convention RTLWrapper.jsx uses
// elsewhere, so preview (dangerouslySetInnerHTML) and printed papers render it correctly too.
const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'ur', label: 'اردو (Urdu)' },
  { code: 'ar', label: 'العربية (Arabic)' },
  { code: 'ps', label: 'پښتو (Pashto)' },
  { code: 'sd', label: 'سنڌي (Sindhi)' },
]

const WRAPPER_RE = /^<div dir="(ltr|rtl)"(?: lang="([a-z]{2})")?[^>]*>([\s\S]*)<\/div>$/i

function unwrapLanguage(html) {
  if (!html) return { language: 'en', inner: '' }
  const match = html.match(WRAPPER_RE)
  if (match) return { language: match[2] || (match[1] === 'rtl' ? 'ur' : 'en'), inner: match[3] }
  return { language: 'en', inner: html }
}

function wrapLanguage(innerHtml, language) {
  const rtl = isRTLLanguage(language)
  return `<div dir="${rtl ? 'rtl' : 'ltr'}" lang="${language}" class="${rtl ? 'font-rtl' : ''}">${innerHtml}</div>`
}

/**
 * RichTextEditor component using TipTap
 * Provides formatting toolbar for text editing, plus:
 * - inline LaTeX equations (type `$x^2$`, or use the ∑ button) rendered via KaTeX
 * - a language selector so Urdu/Arabic/Pashto/Sindhi questions compose and print right-to-left
 * - Diagram Mode (draw/paste a figure) when the caller opts in via the `diagram` prop
 *
 * `diagram` is intentionally the only Diagram Mode surface here -- this component stays
 * upload-agnostic (see DiagramCanvas.jsx) and just relays the picked file to the caller:
 *   { imageUrl, targetLabel, onInsert(file), onRemove }
 * `imageUrl` is a plain image URL (or object URL for an not-yet-uploaded draft), rendered
 * as a small attached-diagram preview under the toolbar when the panel is closed.
 */
export default function RichTextEditor({ value, onChange, placeholder = 'Enter text...', diagram }) {
  const [{ language, inner: initialInner }] = useState(() => unwrapLanguage(value))
  const [currentLanguage, setCurrentLanguage] = useState(language)
  const [diagramOpen, setDiagramOpen] = useState(false)
  const rtl = isRTLLanguage(currentLanguage)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Subscript,
      Superscript,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      MathExtension.configure({ evaluation: false }),
    ],
    content: initialInner || '',
    onUpdate: ({ editor }) => {
      onChange(wrapLanguage(editor.getHTML(), currentLanguage))
    },
  })

  const handleLanguageChange = (nextLanguage) => {
    setCurrentLanguage(nextLanguage)
    if (editor) {
      onChange(wrapLanguage(editor.getHTML(), nextLanguage))
    }
  }

  const insertEquation = () => {
    if (!editor) return
    const from = editor.state.selection.from
    editor.chain().focus().insertContent('$x$').run()
    // Select the placeholder "x" so the teacher can type over it with real LaTeX.
    editor.chain().setTextSelection({ from: from + 1, to: from + 2 }).run()
  }

  if (!editor) {
    return <div>Loading editor...</div>
  }

  const inTable = editor.isActive('table')

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-1 p-1.5 sm:p-2 border border-gray-300 rounded-t bg-gray-50 [&_button]:px-2 [&_button]:py-1 sm:[&_button]:px-3">
        {/* Undo / Redo */}
        <button
          type="button"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          className="px-3 py-1 rounded bg-white border border-gray-300 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          ↶
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          className="px-3 py-1 rounded bg-white border border-gray-300 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Redo (Ctrl+Y)"
          aria-label="Redo"
        >
          ↷
        </button>

        <div className="w-px bg-gray-300"></div>

        {/* Text formatting */}
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`px-3 py-1 rounded font-bold ${editor.isActive('bold') ? 'bg-primary-600 text-white' : 'bg-white border border-gray-300'}`}
          title="Bold (Ctrl+B)"
          aria-label="Bold"
        >
          B
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`px-3 py-1 rounded italic ${editor.isActive('italic') ? 'bg-primary-600 text-white' : 'bg-white border border-gray-300'}`}
          title="Italic (Ctrl+I)"
          aria-label="Italic"
        >
          I
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={`px-3 py-1 rounded line-through ${editor.isActive('strike') ? 'bg-primary-600 text-white' : 'bg-white border border-gray-300'}`}
          title="Strikethrough"
          aria-label="Strikethrough"
        >
          S
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleSubscript().run()}
          className={`px-3 py-1 rounded text-sm ${editor.isActive('subscript') ? 'bg-primary-600 text-white' : 'bg-white border border-gray-300'}`}
          title="Subscript (e.g. H2O)"
          aria-label="Subscript"
        >
          X<sub>2</sub>
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleSuperscript().run()}
          className={`px-3 py-1 rounded text-sm ${editor.isActive('superscript') ? 'bg-primary-600 text-white' : 'bg-white border border-gray-300'}`}
          title="Superscript (e.g. x2)"
          aria-label="Superscript"
        >
          X<sup>2</sup>
        </button>

        <div className="w-px bg-gray-300"></div>

        {/* Headings */}
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={`px-3 py-1 rounded ${editor.isActive('heading', { level: 1 }) ? 'bg-primary-600 text-white' : 'bg-white border border-gray-300'}`}
          title="Heading 1"
          aria-label="Heading 1"
        >
          H1
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={`px-3 py-1 rounded ${editor.isActive('heading', { level: 2 }) ? 'bg-primary-600 text-white' : 'bg-white border border-gray-300'}`}
          title="Heading 2"
          aria-label="Heading 2"
        >
          H2
        </button>

        <div className="w-px bg-gray-300"></div>

        {/* Lists */}
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`px-3 py-1 rounded ${editor.isActive('bulletList') ? 'bg-primary-600 text-white' : 'bg-white border border-gray-300'}`}
          title="Bullet List"
          aria-label="Bullet list"
        >
          •
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`px-3 py-1 rounded ${editor.isActive('orderedList') ? 'bg-primary-600 text-white' : 'bg-white border border-gray-300'}`}
          title="Ordered List"
          aria-label="Ordered list"
        >
          1.
        </button>

        <div className="w-px bg-gray-300"></div>

        {/* Table */}
        <button
          type="button"
          onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
          className="px-3 py-1 rounded bg-white border border-gray-300"
          title="Insert table"
          aria-label="Insert table"
        >
          ⊞
        </button>

        {inTable && (
          <>
            <button
              type="button"
              onClick={() => editor.chain().focus().addColumnAfter().run()}
              className="px-3 py-1 rounded bg-white border border-gray-300"
              title="Add column"
              aria-label="Add column"
            >
              +Col
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().addRowAfter().run()}
              className="px-3 py-1 rounded bg-white border border-gray-300"
              title="Add row"
              aria-label="Add row"
            >
              +Row
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().deleteTable().run()}
              className="px-3 py-1 rounded bg-white border border-gray-300"
              title="Delete table"
              aria-label="Delete table"
            >
              ⊟Table
            </button>
          </>
        )}

        <div className="w-px bg-gray-300"></div>

        {/* Equation (Math/Physics) */}
        <button
          type="button"
          onClick={insertEquation}
          className="px-3 py-1 rounded bg-white border border-gray-300"
          title="Insert equation (LaTeX, e.g. \frac{1}{2} or x^2) — type between $ signs"
          aria-label="Insert equation"
        >
          ∑
        </button>

        {diagram && (
          <>
            <div className="w-px bg-gray-300"></div>
            <button
              type="button"
              onClick={() => setDiagramOpen((open) => !open)}
              className={`px-3 py-1 rounded flex items-center gap-1.5 ${diagramOpen ? 'bg-emerald-600 text-white' : 'bg-white border border-gray-300'}`}
              title="Draw or paste a diagram (geometry, graphs, sketches)"
              aria-label="Draw or paste a diagram"
            >
              ✎ Diagram
            </button>
          </>
        )}

        <div className="w-px bg-gray-300"></div>

        {/* Clear formatting */}
        <button
          type="button"
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
          className="px-3 py-1 rounded bg-white border border-gray-300"
          title="Clear formatting"
          aria-label="Clear formatting"
        >
          ✕
        </button>

        <div className="flex-1" />

        {/* Language / direction — Urdu, Arabic, Pashto, Sindhi papers print/edit right-to-left */}
        <select
          value={currentLanguage}
          onChange={(e) => handleLanguageChange(e.target.value)}
          className="px-2 py-1 rounded bg-white border border-gray-300 text-sm"
          title="Question language (sets text direction for editing and printing)"
          aria-label="Question language"
        >
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {/* Diagram Mode panel -- drops open under the toolbar rather than a separate
          modal, so drawing/pasting a figure stays in the flow of composing the question. */}
      {diagram && diagramOpen && (
        <DiagramCanvas
          targetLabel={diagram.targetLabel}
          onClose={() => setDiagramOpen(false)}
          onInsert={(file) => {
            diagram.onInsert(file)
            setDiagramOpen(false)
          }}
        />
      )}

      {/* Attached diagram preview -- shown once a diagram exists and the panel is
          closed, so it doesn't compete with the draw/import UI for space. */}
      {diagram && !diagramOpen && diagram.imageUrl && (
        <div className="flex items-center gap-3 px-3 py-2 border-x border-b border-gray-300 bg-gray-50">
          <div className="w-14 h-14 border border-gray-300 rounded overflow-hidden bg-white flex-none">
            <img src={diagram.imageUrl} alt="Attached diagram" className="w-full h-full object-contain" />
          </div>
          <span className="text-xs text-gray-500 flex-1">Diagram attached{diagram.targetLabel ? ` — ${diagram.targetLabel}` : ''}</span>
          <button
            type="button"
            onClick={() => setDiagramOpen(true)}
            className="text-xs text-blue-600 hover:underline"
          >
            Replace
          </button>
          {diagram.onRemove && (
            <button
              type="button"
              onClick={diagram.onRemove}
              className="text-xs text-red-600 hover:underline"
            >
              Remove
            </button>
          )}
        </div>
      )}

      {/* Editor area */}
      <div
        dir={rtl ? 'rtl' : 'ltr'}
        className={`border-x border-b border-gray-300 rounded-b p-4 min-h-[250px] bg-white ${rtl ? 'font-rtl' : ''}`}
      >
        <EditorContent
          editor={editor}
          className="prose prose-sm max-w-none focus:outline-none"
          style={{
            fontSize: '14px',
            lineHeight: '1.5',
          }}
        />
      </div>
      {/* Formatting guide — the harder-to-discover inputs (equations, sub/superscript,
          tables) have no obvious UI affordance beyond a toolbar icon, so spell out the
          exact syntax/examples a teacher can copy rather than leaving it to trial and error. */}
      <details className="text-xs text-gray-500 border border-gray-200 rounded bg-gray-50">
        <summary className="cursor-pointer select-none px-3 py-1.5 font-medium text-gray-600 hover:text-gray-800">
          Formatting guide — equations, subscripts, tables, Urdu/Arabic
        </summary>
        <div className="px-3 pb-3 pt-1 space-y-2">
          <div>
            <span className="font-semibold text-gray-600">Equations (LaTeX): </span>
            type between <code className="px-1 bg-white border border-gray-200 rounded">$ $</code> or press <span className="font-semibold">∑</span>.
            <ul className="mt-1 ml-4 list-disc space-y-0.5">
              <li><code className="px-1 bg-white border border-gray-200 rounded">$x^2 + y^2 = z^2$</code> → power (use <code className="px-1 bg-white border border-gray-200 rounded">^</code>)</li>
              <li><code className="px-1 bg-white border border-gray-200 rounded">$\frac{'{'}1{'}'}{'{'}2{'}'}$</code> → fraction</li>
              <li><code className="px-1 bg-white border border-gray-200 rounded">$\sqrt{'{'}x{'}'}$</code> → square root</li>
              <li><code className="px-1 bg-white border border-gray-200 rounded">$\sum_{'{'}i=1{'}'}^{'{'}n{'}'} i$</code> → summation</li>
              <li><code className="px-1 bg-white border border-gray-200 rounded">$\alpha, \beta, \pi, \theta$</code> → Greek letters</li>
            </ul>
          </div>
          <div>
            <span className="font-semibold text-gray-600">Subscript / superscript: </span>
            select the character(s) first, then click <span className="font-semibold">X<sub>2</sub></span> or <span className="font-semibold">X<sup>2</sup></span> —
            useful for chemistry (H<sub>2</sub>O) without writing a full equation.
          </div>
          <div>
            <span className="font-semibold text-gray-600">Tables: </span>
            click <span className="font-semibold">⊞</span> to insert a 3×3 table, then place the cursor in a cell and use
            <span className="font-semibold"> +Col</span>/<span className="font-semibold">+Row</span> to grow it.
          </div>
          <div>
            <span className="font-semibold text-gray-600">Urdu / Arabic / Pashto / Sindhi: </span>
            pick the language from the dropdown above (top-right of the toolbar) — typing and the on-screen preview
            switch to right-to-left automatically (PDF/DOCX export still prints left-to-right for now).
            Type in English first if you don't have an Urdu keyboard layout set up, then paste the Urdu text over it.
          </div>
        </div>
      </details>
    </div>
  )
}
