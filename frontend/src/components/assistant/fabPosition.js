// Pure rules for the draggable Aura button and the panel that opens beside it, kept apart from React so they can
// be tested without a browser. Port of mobile/services/assistantFab.ts; keep the two in step.

export const TAP_SLOP = 8          // a pointer that moves this little or less is still a click
export const NARROW_PX = 640       // below this width the panel is a full-width sheet
export const DEFAULT_SPOT = { side: 'right', yFrac: 1 }

export const isTap = (dx, dy) => Math.hypot(dx, dy) <= TAP_SLOP
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** The highest and lowest top-left y the button may take, inside the window. */
export function yRange(b) {
  const max = Math.max(b.top, b.height - b.bottomReserve - b.boxH)
  return { min: b.top, max }
}

const validSpot = (s) => s && (s.side === 'left' || s.side === 'right') && Number.isFinite(s.yFrac)

/** Where (top-left) a remembered spot sits in this window. A bad or old saved value falls back inside it. */
export function positionFor(spot, b) {
  const s = validSpot(spot) ? spot : DEFAULT_SPOT
  const { min, max } = yRange(b)
  return {
    x: s.side === 'left' ? b.margin : b.width - b.margin - b.boxW,
    y: min + clamp(s.yFrac, 0, 1) * (max - min),
  }
}

/** Where a drop at (x, y) top-left ends up: the nearer side edge, same height. */
export function spotFromDrop(x, y, b) {
  const { min, max } = yRange(b)
  return { side: x + b.boxW / 2 < b.width / 2 ? 'left' : 'right', yFrac: max > min ? clamp((y - min) / (max - min), 0, 1) : 1 }
}

/** Keeps a live drag inside the window. */
export function clampDrag(x, y, b) {
  const { min, max } = yRange(b)
  return { x: clamp(x, 0, b.width - b.boxW), y: clamp(y, min, max) }
}

export function parseSpot(raw) {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    return validSpot(v) ? { side: v.side, yFrac: v.yFrac } : null
  } catch { return null }
}

/**
 * Where the panel goes: beside the button, on the side with room, and never off screen.
 * `fab` is the button's top-left. Narrow windows get a full-width sheet instead.
 */
export function panelRect(fab, b, size = { w: 448, h: 544 }, gap = 10, edge = 8) {
  if (b.width < NARROW_PX) {
    const h = Math.min(size.h, b.height - edge * 2)
    return { sheet: true, left: edge, top: b.height - edge - h, width: b.width - edge * 2, height: h }
  }
  const w = Math.min(size.w, b.width - edge * 2)
  const below = fab.y + b.boxH / 2 < b.height / 2 // button in the upper half: open downwards
  const room = below ? b.height - (fab.y + b.boxH + gap) - edge : fab.y - gap - edge
  const h = Math.min(size.h, Math.max(240, room))
  const top = below ? fab.y + b.boxH + gap : fab.y - gap - h
  // Line the panel up with the button's own edge so they read as one thing.
  const alignRight = fab.x + b.boxW / 2 >= b.width / 2
  const left = clamp(alignRight ? fab.x + b.boxW - w : fab.x, edge, b.width - w - edge)
  return { sheet: false, left, top: clamp(top, edge, Math.max(edge, b.height - h - edge)), width: w, height: h }
}
