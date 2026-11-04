// Entry of the editor page the mobile app shows in a WebView (or an iframe on Expo web). Built by
// scripts/build-rich-editor.mjs into mobile/assets/richEditorHtml.ts; do not import it from the web app.
//
// Messages (JSON strings) to the page:   {type:'init', html, placeholder} | {type:'cmd', name} | {type:'lang', code} | {type:'focus'}
// Messages from the page:                {type:'ready'} | {type:'change', html, blank} | {type:'state', active, language} | {type:'height', px}
import { Editor } from '@tiptap/core'
import { activeFlags, createExtensions, EDITOR_COMMANDS, isRTLLanguage, unwrapLanguage, wrapLanguage } from './richEditorCore'

const target = () => (window.ReactNativeWebView || (window.parent !== window ? window.parent : null))
const post = (msg) => { const t = target(); if (t) t.postMessage(JSON.stringify(msg), '*') }

let editor = null
let language = 'en'
const host = document.getElementById('editor')

const isBlank = (html) => !html || html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() === '' && !/<(table|img|span data-type)/.test(html)

function applyDirection() {
  const rtl = isRTLLanguage(language)
  document.body.setAttribute('dir', rtl ? 'rtl' : 'ltr')
  document.body.classList.toggle('rtl', rtl)
}

function emitChange() {
  const inner = editor.getHTML()
  post({ type: 'change', html: wrapLanguage(inner, language), blank: isBlank(inner) })
}

function emitState() { post({ type: 'state', active: activeFlags(editor), language }) }

function emitHeight() { post({ type: 'height', px: Math.ceil(host.getBoundingClientRect().height) }) }

function init(html, placeholder) {
  const parsed = unwrapLanguage(html || '')
  language = parsed.language
  applyDirection()
  host.setAttribute('data-placeholder', placeholder || '')
  if (editor) editor.destroy()
  editor = new Editor({
    element: host,
    extensions: createExtensions(),
    content: parsed.inner || '',
    onUpdate: () => { host.classList.toggle('empty', isBlank(editor.getHTML())); emitChange(); emitState(); emitHeight() },
    onSelectionUpdate: emitState,
    onFocus: emitState,
  })
  host.classList.toggle('empty', isBlank(editor.getHTML()))
  emitState()
  emitHeight()
}

function onMessage(event) {
  let msg = null
  try { msg = JSON.parse(event.data) } catch { return }
  if (!msg || typeof msg !== 'object') return
  if (msg.type === 'init') init(msg.html, msg.placeholder)
  else if (!editor) return
  else if (msg.type === 'cmd' && EDITOR_COMMANDS[msg.name]) { EDITOR_COMMANDS[msg.name](editor); emitState() }
  else if (msg.type === 'lang') { language = msg.code; applyDirection(); emitChange(); emitState() }
  else if (msg.type === 'focus') editor.commands.focus()
}

// Android WebView delivers messages on document, iOS and browsers on window.
window.addEventListener('message', onMessage)
document.addEventListener('message', onMessage)
new ResizeObserver(emitHeight).observe(host)
post({ type: 'ready' })
