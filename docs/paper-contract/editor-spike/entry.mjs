import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import * as MathNS from '@aarkue/tiptap-math-extension'
const MathExtension = (MathNS.default && MathNS.default.configure) ? MathNS.default : MathNS.MathExtension
window.createEditor = (el, html, onChange) => new Editor({ element: el, extensions: [StarterKit, Subscript, Superscript, Table.configure({ resizable: true }), TableRow, TableHeader, TableCell, MathExtension.configure({ evaluation: false })], content: html, onUpdate: ({ editor }) => onChange(editor.getHTML()) })
