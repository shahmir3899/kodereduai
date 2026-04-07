import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { brochureApi } from '../../services/api'

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function ToolbarButton({ onClick, active, title, children }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      title={title}
      className={`px-2 py-1 rounded text-sm font-medium transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
      }`}
    >
      {children}
    </button>
  )
}

function EditorToolbar({ editor }) {
  if (!editor) return null
  return (
    <div className="flex flex-wrap gap-1 p-2 bg-gray-50 border-b border-gray-200 rounded-t-lg">
      <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
        <s>S</s>
      </ToolbarButton>

      <div className="w-px bg-gray-300 mx-1 self-stretch" />

      <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2">
        H2
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3">
        H3
      </ToolbarButton>

      <div className="w-px bg-gray-300 mx-1 self-stretch" />

      <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">
        • List
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
        1. List
      </ToolbarButton>

      <div className="w-px bg-gray-300 mx-1 self-stretch" />

      <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Blockquote">
        ❝
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()} active={false} title="Horizontal rule">
        ―
      </ToolbarButton>

      <div className="w-px bg-gray-300 mx-1 self-stretch" />

      <ToolbarButton
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        active={editor.isActive('table')}
        title="Insert table"
      >
        Table
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().addRowAfter().run()} active={false} title="Add row">
        +Row
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().addColumnAfter().run()} active={false} title="Add column">
        +Col
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().deleteRow().run()} active={false} title="Delete row">
        -Row
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().deleteColumn().run()} active={false} title="Delete column">
        -Col
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().deleteTable().run()} active={false} title="Delete table">
        DelTbl
      </ToolbarButton>

      <div className="flex-1" />

      <ToolbarButton onClick={() => editor.chain().focus().undo().run()} active={false} title="Undo">
        ↩ Undo
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().redo().run()} active={false} title="Redo">
        Redo ↪
      </ToolbarButton>
    </div>
  )
}

// ─── Section Editor ───────────────────────────────────────────────────────────

function SectionEditor({ section, onSaved }) {
  const queryClient = useQueryClient()
  const [isDirty, setIsDirty] = useState(false)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    // If section has TipTap JSON, use it; otherwise parse the seeded HTML
    content: Object.keys(section.content || {}).length > 0
      ? section.content
      : section.content_html || '',
    onUpdate: () => setIsDirty(true),
  })

  const saveMutation = useMutation({
    mutationFn: (data) => brochureApi.updateSection(section.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['brochure-sections'])
      setIsDirty(false)
      onSaved?.()
    },
  })

  const handleSave = useCallback(() => {
    if (!editor) return
    const json = editor.getJSON()
    const html = editor.getHTML()
    saveMutation.mutate({ content: json, content_html: html })
  }, [editor, saveMutation])

  return (
    <div className="flex flex-col h-full">
      {/* Section header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
            {section.key}
          </span>
          <h2 className="text-lg font-bold text-gray-800 mt-1">{section.title}</h2>
          {section.updated_by_name && (
            <p className="text-xs text-gray-400">
              Last saved by {section.updated_by_name} · {new Date(section.updated_at).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || saveMutation.isPending}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              isDirty
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            {saveMutation.isPending ? 'Saving…' : isDirty ? 'Save Changes' : 'Saved'}
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-auto bg-white">
        <EditorToolbar editor={editor} />
        <EditorContent
          editor={editor}
          className="prose max-w-none p-6 min-h-64 focus:outline-none [&_.ProseMirror_table]:w-full [&_.ProseMirror_table]:border-collapse [&_.ProseMirror_th]:border [&_.ProseMirror_th]:border-gray-300 [&_.ProseMirror_th]:bg-gray-100 [&_.ProseMirror_th]:px-2 [&_.ProseMirror_th]:py-1 [&_.ProseMirror_td]:border [&_.ProseMirror_td]:border-gray-300 [&_.ProseMirror_td]:px-2 [&_.ProseMirror_td]:py-1"
        />
      </div>

      {saveMutation.isError && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-200 text-red-600 text-sm">
          Failed to save. Please try again.
        </div>
      )}
    </div>
  )
}

// ─── Preview Panel ────────────────────────────────────────────────────────────

function PreviewPanel() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['brochure-preview'],
    queryFn: brochureApi.getPreviewHtml,
    staleTime: 0,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Loading preview…
      </div>
    )
  }

  const html = data?.data?.html || ''

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
        <span className="font-semibold text-gray-700">Live Preview</span>
        <button
          type="button"
          onClick={() => refetch()}
          className="text-sm text-blue-600 hover:underline"
        >
          Refresh
        </button>
      </div>
      <div className="flex-1 overflow-auto bg-gray-50 p-4">
        <div
          className="bg-white rounded-lg shadow-sm mx-auto max-w-4xl"
          style={{ minHeight: '600px' }}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BrochurePage() {
  const [activeTab, setActiveTab] = useState('edit')
  const [activeSectionId, setActiveSectionId] = useState(null)
  const [savedMsg, setSavedMsg] = useState('')
  const [downloading, setDownloading] = useState(false)
  const queryClient = useQueryClient()

  const { data: sectionsData, isLoading } = useQuery({
    queryKey: ['brochure-sections'],
    queryFn: brochureApi.getSections,
  })

  const sections = sectionsData?.data?.results || sectionsData?.data || []
  const activeSection = sections.find((s) => s.id === activeSectionId) || sections[0]

  const handleDownloadPdf = async () => {
    setDownloading(true)
    try {
      const response = await brochureApi.downloadPdf()
      const url = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'KoderEduAI_Brochure.pdf'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('PDF generation failed. Make sure WeasyPrint is installed on the server.')
    } finally {
      setDownloading(false)
    }
  }

  const handleSaved = () => {
    setSavedMsg('Saved!')
    setTimeout(() => setSavedMsg(''), 2000)
    queryClient.invalidateQueries(['brochure-preview'])
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Loading brochure sections…
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-64px)] bg-gray-100">
      {/* ── Left sidebar ── */}
      <aside className="w-56 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-4 py-4 border-b border-gray-200">
          <h1 className="text-sm font-bold text-gray-800 uppercase tracking-wider">Brochure Editor</h1>
          <p className="text-xs text-gray-400 mt-0.5">Platform admins only</p>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => { setActiveSectionId(section.id); setActiveTab('edit') }}
              className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                activeSection?.id === section.id
                  ? 'bg-blue-50 text-blue-700 font-semibold border-r-2 border-blue-600'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span className="block truncate">{section.title}</span>
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-200 space-y-2">
          <div className="flex rounded-lg overflow-hidden border border-gray-200">
            <button
              type="button"
              onClick={() => setActiveTab('edit')}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                activeTab === 'edit'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              ✏️ Edit
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                activeTab === 'preview'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              👁 Preview
            </button>
          </div>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={downloading}
            className={`w-full py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
              downloading
                ? 'bg-red-400 text-white cursor-wait'
                : 'bg-red-600 text-white hover:bg-red-700'
            }`}
          >
            {downloading ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Generating PDF…
              </>
            ) : (
              '⬇ Download PDF'
            )}
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {savedMsg && (
          <div className="absolute top-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-sm font-medium">
            {savedMsg}
          </div>
        )}

        {activeTab === 'preview' ? (
          <PreviewPanel />
        ) : activeSection ? (
          <SectionEditor
            key={activeSection.id}
            section={activeSection}
            onSaved={handleSaved}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            Select a section from the sidebar to start editing.
          </div>
        )}
      </main>
    </div>
  )
}
