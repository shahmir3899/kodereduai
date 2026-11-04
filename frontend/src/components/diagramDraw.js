// The drawing primitives of Diagram Mode, shared by the web DiagramCanvas and the page the mobile app shows in a
// WebView (frontend/src/components/diagramEntry.js, built by scripts/build-rich-editor.mjs), so a figure drawn on
// either looks the same. Keep this file free of React and the DOM.

// Internal drawing resolution — independent of the CSS display size, so the
// exported PNG stays sharp regardless of how small the panel renders on a phone.
export const CANVAS_WIDTH = 860
export const CANVAS_HEIGHT = 540

export const COLORS = ['#111827', '#dc2626', '#2563eb', '#16a34a']
export const WEIGHTS = [2, 4, 7]

// Tool ids in toolbar order (the web draws icons for them, the mobile page uses short labels).
export const TOOL_IDS = ['pen', 'line', 'rect', 'circle', 'ellipse', 'triangle', 'arrow', 'text', 'eraser']

export function drawAction(ctx, action) {
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

export function redraw(ctx, actions, draft) {
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
  actions.forEach((action) => drawAction(ctx, action))
  if (draft) drawAction(ctx, draft)
}

