import { useEffect, useReducer, useRef, useState } from 'react'

// Diagram Mode's drawing surface — pen/shapes/eraser/text on a fixed-resolution
// canvas, plus a paste/drop "Import" tab for figures copied in from elsewhere.
// Deliberately upload-agnostic: it hands the finished image to `onInsert(file)`
// as a plain File and lets the caller decide where it's uploaded (question body,
// an MCQ option, the answer key — see QuestionViewSet.DIAGRAM_SLOT_FIELDS on the
// backend), so this component has no API/auth knowledge at all.

// Internal drawing resolution — independent of the CSS display size, so the
// exported PNG stays sharp regardless of how small the panel renders on a phone.
const CANVAS_WIDTH = 860
const CANVAS_HEIGHT = 540

const COLORS = ['#111827', '#dc2626', '#2563eb', '#16a34a']
const WEIGHTS = [2, 4, 7]

// Icon-only toolbar (see feedback: teachers scanning a drawing app expect
// pictograms, not English tool names, and it's tighter horizontally).
// `title` still carries the accessible/hover-tooltip label.
const TOOLS = [
  {
    id: 'pen',
    title: 'Pen — freehand',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 21l3.5-1 11-11-2.5-2.5-11 11L3 21z" />
        <path d="M14 5l2.5 2.5" />
      </svg>
    ),
  },
  {
    id: 'line',
    title: 'Straight line',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M4 20L20 4" />
      </svg>
    ),
  },
  {
    id: 'rect',
    title: 'Rectangle',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="4" y="6" width="16" height="12" rx="1" />
      </svg>
    ),
  },
  {
    id: 'circle',
    title: 'Circle',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="8" />
      </svg>
    ),
  },
  {
    id: 'ellipse',
    title: 'Ellipse / oval',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <ellipse cx="12" cy="12" rx="9" ry="6" />
      </svg>
    ),
  },
  {
    id: 'triangle',
    title: 'Triangle',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M12 4L20 20H4Z" />
      </svg>
    ),
  },
  {
    id: 'arrow',
    title: 'Arrow',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12h14M13 6l6 6-6 6" />
      </svg>
    ),
  },
  {
    id: 'text',
    title: 'Text label — click to place',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M5 6h14M12 6v13" />
      </svg>
    ),
  },
  {
    id: 'eraser',
    title: 'Eraser',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 15l6-6 6 6-4 4H10l-4-4z" />
        <path d="M10 19h9" />
      </svg>
    ),
  },
]

function drawAction(ctx, action) {
  ctx.strokeStyle = action.color
  ctx.fillStyle = action.color
  ctx.lineWidth = action.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  switch (action.type) {
    case 'path': {
      if (action.points.length < 2) return
      ctx.beginPath()
      ctx.moveTo(action.points[0].x, action.points[0].y)
      action.points.slice(1).forEach((p) => ctx.lineTo(p.x, p.y))
      ctx.stroke()
      return
    }
    case 'line': {
      ctx.beginPath()
      ctx.moveTo(action.x1, action.y1)
      ctx.lineTo(action.x2, action.y2)
      ctx.stroke()
      return
    }
    case 'rect': {
      ctx.strokeRect(
        Math.min(action.x1, action.x2),
        Math.min(action.y1, action.y2),
        Math.abs(action.x2 - action.x1),
        Math.abs(action.y2 - action.y1),
      )
      return
    }
    case 'circle': {
      const radius = Math.hypot(action.x2 - action.x1, action.y2 - action.y1)
      ctx.beginPath()
      ctx.arc(action.x1, action.y1, radius, 0, Math.PI * 2)
      ctx.stroke()
      return
    }
    case 'ellipse': {
      const cx = (action.x1 + action.x2) / 2
      const cy = (action.y1 + action.y2) / 2
      const rx = Math.abs(action.x2 - action.x1) / 2
      const ry = Math.abs(action.y2 - action.y1) / 2
      ctx.beginPath()
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      ctx.stroke()
      return
    }
    case 'triangle': {
      const left = Math.min(action.x1, action.x2)
      const right = Math.max(action.x1, action.x2)
      const top = Math.min(action.y1, action.y2)
      const bottom = Math.max(action.y1, action.y2)
      ctx.beginPath()
      ctx.moveTo((left + right) / 2, top)
      ctx.lineTo(right, bottom)
      ctx.lineTo(left, bottom)
      ctx.closePath()
      ctx.stroke()
      return
    }
    case 'arrow': {
      const headLength = Math.max(10, action.width * 2.5)
      const angle = Math.atan2(action.y2 - action.y1, action.x2 - action.x1)
      ctx.beginPath()
      ctx.moveTo(action.x1, action.y1)
      ctx.lineTo(action.x2, action.y2)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(action.x2, action.y2)
      ctx.lineTo(
        action.x2 - headLength * Math.cos(angle - Math.PI / 6),
        action.y2 - headLength * Math.sin(angle - Math.PI / 6),
      )
      ctx.lineTo(
        action.x2 - headLength * Math.cos(angle + Math.PI / 6),
        action.y2 - headLength * Math.sin(angle + Math.PI / 6),
      )
      ctx.closePath()
      ctx.fill()
      return
    }
    case 'text': {
      ctx.font = `${14 + action.width * 3}px "IBM Plex Mono", ui-monospace, monospace`
      ctx.textBaseline = 'top'
      ctx.fillText(action.text, action.x1, action.y1)
      return
    }
    default:
      return
  }
}

function redraw(ctx, actions, draft) {
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
  actions.forEach((action) => drawAction(ctx, action))
  if (draft) drawAction(ctx, draft)
}

/**
 * DiagramCanvas — inline Draw/Import panel for Diagram Mode.
 *
 * @param {(file: File) => void} onInsert - called with the finished PNG (Draw tab)
 *   or the pasted/dropped/chosen image (Import tab). Caller uploads it.
 * @param {() => void} onClose - Cancel button.
 * @param {string} [targetLabel] - e.g. "Question body", "Option A", "Model answer" —
 *   shown as a hint so it's clear which slot this will attach to.
 */
export default function DiagramCanvas({ onInsert, onClose, targetLabel }) {
  const [activeTab, setActiveTab] = useState('draw')

  // --- Draw tab state ---
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const actionsRef = useRef([])
  const redoStackRef = useRef([])
  const draftRef = useRef(null)
  const drawingRef = useRef(false)
  const [tool, setTool] = useState('pen')
  const [color, setColor] = useState(COLORS[0])
  const [weight, setWeight] = useState(WEIGHTS[1])
  // Bumped on every commit/undo/redo/clear purely to re-render toolbar button
  // states (Undo/Redo disabled-ness) -- the canvas itself is drawn imperatively
  // and never reads this value.
  const [, bump] = useReducer((n) => n + 1, 0)
  const [textEditor, setTextEditor] = useState(null) // { x, y, canvasX, canvasY }
  const textInputRef = useRef(null)

  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d')
    ctxRef.current = ctx
    redraw(ctx, actionsRef.current, null)
  }, [])

  useEffect(() => {
    if (textEditor && textInputRef.current) textInputRef.current.focus()
  }, [textEditor])

  const getCanvasPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const scaleX = CANVAS_WIDTH / rect.width
    const scaleY = CANVAS_HEIGHT / rect.height
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }

  const commitAction = (action) => {
    actionsRef.current = [...actionsRef.current, action]
    redoStackRef.current = []
    draftRef.current = null
    redraw(ctxRef.current, actionsRef.current, null)
    bump()
  }

  const handlePointerDown = (e) => {
    if (tool === 'text') {
      const canvasPos = getCanvasPos(e)
      setTextEditor({ x: e.clientX, y: e.clientY, canvasX: canvasPos.x, canvasY: canvasPos.y })
      return
    }
    canvasRef.current.setPointerCapture(e.pointerId)
    drawingRef.current = true
    const pos = getCanvasPos(e)
    const isEraser = tool === 'eraser'
    if (tool === 'pen' || isEraser) {
      draftRef.current = {
        type: 'path',
        points: [pos],
        color: isEraser ? '#ffffff' : color,
        width: isEraser ? weight * 4 : weight,
      }
    } else {
      draftRef.current = { type: tool, x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y, color, width: weight }
    }
    redraw(ctxRef.current, actionsRef.current, draftRef.current)
  }

  const handlePointerMove = (e) => {
    if (!drawingRef.current || !draftRef.current) return
    const pos = getCanvasPos(e)
    if (draftRef.current.type === 'path') {
      draftRef.current.points.push(pos)
    } else {
      draftRef.current.x2 = pos.x
      draftRef.current.y2 = pos.y
    }
    redraw(ctxRef.current, actionsRef.current, draftRef.current)
  }

  const handlePointerUp = () => {
    if (!drawingRef.current || !draftRef.current) return
    drawingRef.current = false
    commitAction(draftRef.current)
  }

  const commitText = () => {
    const value = textInputRef.current?.value?.trim()
    if (value && textEditor) {
      commitAction({ type: 'text', x1: textEditor.canvasX, y1: textEditor.canvasY, text: value, color, width: weight })
    }
    setTextEditor(null)
  }

  const handleUndo = () => {
    if (!actionsRef.current.length) return
    const last = actionsRef.current[actionsRef.current.length - 1]
    actionsRef.current = actionsRef.current.slice(0, -1)
    redoStackRef.current = [...redoStackRef.current, last]
    redraw(ctxRef.current, actionsRef.current, null)
    bump()
  }

  const handleRedo = () => {
    if (!redoStackRef.current.length) return
    const next = redoStackRef.current[redoStackRef.current.length - 1]
    redoStackRef.current = redoStackRef.current.slice(0, -1)
    actionsRef.current = [...actionsRef.current, next]
    redraw(ctxRef.current, actionsRef.current, null)
    bump()
  }

  const handleClear = () => {
    if (!actionsRef.current.length) return
    if (!window.confirm('Clear the whole drawing? This cannot be undone.')) return
    actionsRef.current = []
    redoStackRef.current = []
    redraw(ctxRef.current, actionsRef.current, null)
    bump()
  }

  const handleInsertDrawing = () => {
    canvasRef.current.toBlob((blob) => {
      if (!blob) return
      onInsert(new File([blob], 'diagram.png', { type: 'image/png' }))
    }, 'image/png')
  }

  // --- Import tab state ---
  const [importFile, setImportFile] = useState(null)
  const [importPreviewUrl, setImportPreviewUrl] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    return () => {
      if (importPreviewUrl) URL.revokeObjectURL(importPreviewUrl)
    }
  }, [importPreviewUrl])

  const acceptImportFile = (file) => {
    if (!file || !file.type?.startsWith('image/')) return
    if (importPreviewUrl) URL.revokeObjectURL(importPreviewUrl)
    setImportFile(file)
    setImportPreviewUrl(URL.createObjectURL(file))
  }

  useEffect(() => {
    if (activeTab !== 'import') return
    const handlePaste = (e) => {
      const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith('image/'))
      if (item) acceptImportFile(item.getAsFile())
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, importPreviewUrl])

  const handleDrop = (e) => {
    e.preventDefault()
    acceptImportFile(e.dataTransfer.files?.[0])
  }

  const tbtnClass = (active) =>
    `w-9 h-9 flex items-center justify-center rounded border ${active ? 'bg-blue-500 text-white border-blue-500' : 'bg-white border-gray-300 text-gray-700'}`

  return (
    <div className="border-x border-b border-gray-300 rounded-b bg-emerald-50/40">
      <div className="flex gap-4 px-4 pt-2 border-b border-gray-300">
        <button
          type="button"
          onClick={() => setActiveTab('draw')}
          className={`pb-2 text-xs font-medium uppercase tracking-wide border-b-2 -mb-px ${activeTab === 'draw' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500'}`}
        >
          ✎ Draw
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('import')}
          className={`pb-2 text-xs font-medium uppercase tracking-wide border-b-2 -mb-px ${activeTab === 'import' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500'}`}
        >
          📋 Import image
        </button>
        <div className="flex-1" />
        <button type="button" onClick={onClose} className="pb-2 text-xs text-gray-400 hover:text-gray-600">
          Close
        </button>
      </div>

      {activeTab === 'draw' && (
        <div className="p-4">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <div className="flex gap-1">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  title={t.title}
                  aria-label={t.title}
                  onClick={() => setTool(t.id)}
                  className={tbtnClass(tool === t.id)}
                >
                  <span className="w-[18px] h-[18px]">{t.icon}</span>
                </button>
              ))}
            </div>
            <div className="w-px self-stretch bg-gray-300" />
            <div className="flex gap-1.5 items-center">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  onClick={() => setColor(c)}
                  style={{ backgroundColor: c }}
                  className={`w-5 h-5 rounded-full border-2 ${color === c ? 'border-blue-500' : 'border-white'} ring-1 ring-gray-300`}
                />
              ))}
            </div>
            <div className="w-px self-stretch bg-gray-300" />
            <div className="flex gap-1">
              {WEIGHTS.map((w) => (
                <button
                  key={w}
                  type="button"
                  title={`Stroke weight ${w}px`}
                  onClick={() => setWeight(w)}
                  className={`w-8 h-8 rounded border flex items-center justify-center ${weight === w ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white'}`}
                >
                  <span className="rounded-full bg-gray-800" style={{ width: w + 2, height: w + 2 }} />
                </button>
              ))}
            </div>
            <div className="w-px self-stretch bg-gray-300" />
            <button type="button" onClick={handleUndo} className="px-3 py-1 rounded bg-white border border-gray-300" title="Undo">
              ↶
            </button>
            <button type="button" onClick={handleRedo} className="px-3 py-1 rounded bg-white border border-gray-300" title="Redo">
              ↷
            </button>
          </div>

          <div className="relative w-full mx-auto bg-white border border-gray-300 rounded" style={{ maxWidth: 560, aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}>
            <canvas
              ref={canvasRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              className="w-full h-full rounded cursor-crosshair touch-none"
              style={{
                backgroundImage:
                  'linear-gradient(to right, #eef1e8 1px, transparent 1px), linear-gradient(to bottom, #eef1e8 1px, transparent 1px)',
                backgroundSize: '24px 24px',
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            />
            {textEditor && (
              <input
                ref={textInputRef}
                type="text"
                className="absolute z-10 text-sm px-1 py-0.5 border border-blue-400 rounded bg-white"
                style={{
                  left: `${((textEditor.canvasX / CANVAS_WIDTH) * 100).toFixed(2)}%`,
                  top: `${((textEditor.canvasY / CANVAS_HEIGHT) * 100).toFixed(2)}%`,
                  color,
                }}
                onBlur={commitText}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitText()
                  if (e.key === 'Escape') setTextEditor(null)
                }}
              />
            )}
          </div>
          <p className="text-xs text-gray-400 mt-1.5">Grid is on-screen alignment only — it isn't part of the exported image.</p>

          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-gray-500">
              {targetLabel ? <>Attaches to: <b className="text-gray-700">{targetLabel}</b></> : null}
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={handleClear} className="px-3 py-1.5 text-sm rounded border border-gray-300 bg-white">
                Clear
              </button>
              <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-transparent text-gray-500">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleInsertDrawing}
                className="px-3 py-1.5 text-sm rounded bg-emerald-600 text-white font-medium disabled:opacity-40"
                disabled={actionsRef.current.length === 0}
              >
                Insert diagram
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'import' && (
        <div className="p-4">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="flex items-center gap-3 p-4 border-2 border-dashed border-gray-300 rounded-lg bg-white"
          >
            <span className="text-2xl">🖼️</span>
            <div className="text-sm text-gray-700">
              <b>Paste an image</b> — <kbd className="px-1 border border-gray-300 rounded text-xs">Ctrl</kbd>+
              <kbd className="px-1 border border-gray-300 rounded text-xs">V</kbd>, or drop a file
              <div className="text-xs text-gray-400 mt-0.5">
                Search for the figure anywhere else (Google Images, a textbook scan…), copy it, and paste it here.
              </div>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="ml-auto px-3 py-1.5 text-sm rounded border border-gray-300 bg-white whitespace-nowrap"
            >
              Choose file…
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => acceptImportFile(e.target.files?.[0])}
            />
          </div>

          {importPreviewUrl && (
            <div className="flex items-center gap-3 mt-3">
              <div className="w-16 h-16 border border-gray-300 rounded overflow-hidden bg-white flex-none">
                <img src={importPreviewUrl} alt="Pasted preview" className="w-full h-full object-contain" />
              </div>
              <span className="text-xs text-gray-500">{importFile?.name || 'Pasted from clipboard'}</span>
            </div>
          )}

          <div className="flex items-center justify-between mt-4">
            <span className="text-xs text-gray-500">
              {targetLabel ? <>Attaches to: <b className="text-gray-700">{targetLabel}</b></> : null}
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-transparent text-gray-500">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => importFile && onInsert(importFile)}
                className="px-3 py-1.5 text-sm rounded bg-emerald-600 text-white font-medium disabled:opacity-40"
                disabled={!importFile}
              >
                Use this image
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
