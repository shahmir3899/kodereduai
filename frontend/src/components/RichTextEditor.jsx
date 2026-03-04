import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useState } from 'react'

/**
 * RichTextEditor component using TipTap
 * Provides formatting toolbar for text editing
 */
export default function RichTextEditor({ value, onChange, placeholder = 'Enter text...' }) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: value || '',
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
  })

  if (!editor) {
    return <div>Loading editor...</div>
  }

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-1 p-2 border border-gray-300 rounded-t bg-gray-50">
        {/* Text formatting */}
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`px-3 py-1 rounded font-bold ${editor.isActive('bold') ? 'bg-blue-500 text-white' : 'bg-white border border-gray-300'}`}
          title="Bold (Ctrl+B)"
        >
          B
        </button>

        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`px-3 py-1 rounded italic ${editor.isActive('italic') ? 'bg-blue-500 text-white' : 'bg-white border border-gray-300'}`}
          title="Italic (Ctrl+I)"
        >
          I
        </button>

        <button
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={`px-3 py-1 rounded line-through ${editor.isActive('strike') ? 'bg-blue-500 text-white' : 'bg-white border border-gray-300'}`}
          title="Strikethrough"
        >
          S
        </button>

        <div className="w-px bg-gray-300"></div>

        {/* Headings */}
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={`px-3 py-1 rounded ${editor.isActive('heading', { level: 1 }) ? 'bg-blue-500 text-white' : 'bg-white border border-gray-300'}`}
          title="Heading 1"
        >
          H1
        </button>

        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={`px-3 py-1 rounded ${editor.isActive('heading', { level: 2 }) ? 'bg-blue-500 text-white' : 'bg-white border border-gray-300'}`}
          title="Heading 2"
        >
          H2
        </button>

        <div className="w-px bg-gray-300"></div>

        {/* Lists */}
        <button
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`px-3 py-1 rounded ${editor.isActive('bulletList') ? 'bg-blue-500 text-white' : 'bg-white border border-gray-300'}`}
          title="Bullet List"
        >
          •
        </button>

        <button
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`px-3 py-1 rounded ${editor.isActive('orderedList') ? 'bg-blue-500 text-white' : 'bg-white border border-gray-300'}`}
          title="Ordered List"
        >
          1.
        </button>

        <div className="w-px bg-gray-300"></div>

        {/* Alignment */}
        <button
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          className={`px-3 py-1 rounded ${editor.isActive({ textAlign: 'left' }) ? 'bg-blue-500 text-white' : 'bg-white border border-gray-300'}`}
          title="Align Left"
        >
          ⬅
        </button>

        <button
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          className={`px-3 py-1 rounded ${editor.isActive({ textAlign: 'center' }) ? 'bg-blue-500 text-white' : 'bg-white border border-gray-300'}`}
          title="Align Center"
        >
          ⬜
        </button>

        <button
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          className={`px-3 py-1 rounded ${editor.isActive({ textAlign: 'right' }) ? 'bg-blue-500 text-white' : 'bg-white border border-gray-300'}`}
          title="Align Right"
        >
          ➡
        </button>

        <div className="w-px bg-gray-300"></div>

        {/* Clear formatting */}
        <button
          onClick={() => editor.chain().focus().clearNodes().run()}
          className="px-3 py-1 rounded bg-white border border-gray-300"
          title="Clear formatting"
        >
          ✕
        </button>
      </div>

      {/* Editor area */}
      <div className="border-x border-b border-gray-300 rounded-b p-4 min-h-[250px] bg-white">
        <EditorContent
          editor={editor}
          className="prose prose-sm max-w-none focus:outline-none"
          style={{
            fontSize: '14px',
            lineHeight: '1.5',
          }}
        />
      </div>
    </div>
  )
}
