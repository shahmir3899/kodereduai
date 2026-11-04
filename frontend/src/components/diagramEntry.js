// Entry of the drawing page the mobile app shows in a WebView (or an iframe on Expo web), for figures on a question.
// Built by scripts/build-rich-editor.mjs into mobile/assets/diagramPadHtml.ts; do not import it from the web app.
// It draws with the same primitives as the web's DiagramCanvas (diagramDraw.js).
//
// To the page:   {type:'init'} | {type:'export'} | {type:'tool', id} | {type:'color', value} | {type:'weight', value}
//                {type:'undo'} | {type:'redo'} | {type:'clear'} | {type:'text', value} (text for the label being placed)
// From the page: {type:'ready'} | {type:'state', tool, color, weight, canUndo, canRedo, empty} | {type:'png', data} | {type:'needText'}
import { CANVAS_HEIGHT, CANVAS_WIDTH, COLORS, redraw, TOOL_IDS, WEIGHTS } from './diagramDraw'

const target = () => (window.ReactNativeWebView || (window.parent !== window ? window.parent : null))
const post = (msg) => { const t = target(); if (t) t.postMessage(JSON.stringify(msg), '*') }

const canvas = document.getElementById('pad')
canvas.width = CANVAS_WIDTH
canvas.height = CANVAS_HEIGHT
const ctx = canvas.getContext('2d')

let actions = []
let redoStack = []
let draft = null
let drawing = false
let tool = 'pen'
let color = COLORS[0]
let weight = WEIGHTS[1]
let pendingText = null // where a text label will go once the app sends its words

const paint = () => redraw(ctx, actions, draft)
const state = () => post({ type: 'state', tool, color, weight, canUndo: actions.length > 0, canRedo: redoStack.length > 0, empty: actions.length === 0 })

function pos(e) {
  const r = canvas.getBoundingClientRect()
  return { x: (e.clientX - r.left) * (CANVAS_WIDTH / r.width), y: (e.clientY - r.top) * (CANVAS_HEIGHT / r.height) }
}

function commit(action) {
  actions = [...actions, action]
  redoStack = []
  draft = null
  paint()
  state()
}

canvas.addEventListener('pointerdown', (e) => {
  const p = pos(e)
  if (tool === 'text') { pendingText = p; post({ type: 'needText' }); return }
  if (canvas.setPointerCapture && e.pointerId !== undefined) { try { canvas.setPointerCapture(e.pointerId) } catch { /* not capturable */ } }
  drawing = true
  const eraser = tool === 'eraser'
  draft = (tool === 'pen' || eraser)
    ? { type: 'path', points: [p], color: eraser ? '#ffffff' : color, width: eraser ? weight * 4 : weight }
    : { type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, width: weight }
  paint()
})

canvas.addEventListener('pointermove', (e) => {
  if (!drawing || !draft) return
  const p = pos(e)
  if (draft.type === 'path') draft.points.push(p)
  else { draft.x2 = p.x; draft.y2 = p.y }
  paint()
})

const finish = () => { if (!drawing || !draft) return; drawing = false; commit(draft) }
canvas.addEventListener('pointerup', finish)
canvas.addEventListener('pointercancel', finish)

function onMessage(event) {
  let msg = null
  try { msg = JSON.parse(event.data) } catch { return }
  if (!msg || typeof msg !== 'object') return
  switch (msg.type) {
    case 'init': actions = []; redoStack = []; draft = null; paint(); state(); break
    case 'tool': if (TOOL_IDS.includes(msg.id)) { tool = msg.id; state() } break
    case 'color': if (COLORS.includes(msg.value)) { color = msg.value; state() } break
    case 'weight': if (WEIGHTS.includes(msg.value)) { weight = msg.value; state() } break
    case 'undo': if (actions.length) { redoStack = [...redoStack, actions[actions.length - 1]]; actions = actions.slice(0, -1); paint(); state() } break
    case 'redo': if (redoStack.length) { actions = [...actions, redoStack[redoStack.length - 1]]; redoStack = redoStack.slice(0, -1); paint(); state() } break
    case 'clear': actions = []; redoStack = []; paint(); state(); break
    case 'text': {
      const value = String(msg.value ?? '').trim()
      if (value && pendingText) commit({ type: 'text', x1: pendingText.x, y1: pendingText.y, text: value, color, width: weight })
      pendingText = null
      break
    }
    case 'export': post({ type: 'png', data: canvas.toDataURL('image/png') }); break
    default: break
  }
}

window.addEventListener('message', onMessage)
document.addEventListener('message', onMessage)
paint()
post({ type: 'ready' })
state()
