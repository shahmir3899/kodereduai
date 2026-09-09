/**
 * Draws 1-5 star ratings as small vector shapes rather than a unicode glyph -
 * jsPDF's built-in fonts don't reliably render "★" (it falls back to a blank
 * box in some viewers), so a hand-drawn star path is the only guaranteed way
 * to get an actual star on the page.
 */
function starPoints(size) {
  const outerR = size / 2
  const innerR = outerR * 0.42
  const points = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR
    const angle = i * (Math.PI / 5) - Math.PI / 2
    points.push([r * Math.cos(angle), r * Math.sin(angle)])
  }
  return points
}

function drawStar(doc, cx, cy, size, filled, filledColor, emptyColor) {
  const pts = starPoints(size)
  const deltas = []
  for (let i = 1; i < pts.length; i++) {
    deltas.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]])
  }
  deltas.push([pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]])
  const originX = cx + pts[0][0]
  const originY = cy + pts[0][1]
  if (filled) {
    doc.setFillColor(...filledColor)
    doc.setDrawColor(...filledColor)
    doc.lines(deltas, originX, originY, [1, 1], 'F', true)
  } else {
    doc.setDrawColor(...emptyColor)
    doc.setLineWidth(0.25)
    doc.lines(deltas, originX, originY, [1, 1], 'S', true)
  }
}

/**
 * Draws a row of 5 stars starting at (x, y), y being their vertical center.
 * `rating` is 1-5 (or null/undefined for "not rated", which draws all 5 outlined).
 * Returns the total width drawn.
 */
export function drawStarRow(doc, x, y, rating, opts = {}) {
  const { size = 3, gap = 0.8, filledColor = [79, 70, 229], emptyColor = [210, 210, 218] } = opts
  const step = size + gap
  for (let i = 0; i < 5; i++) {
    const cx = x + size / 2 + i * step
    drawStar(doc, cx, y, size, rating != null && i < rating, filledColor, emptyColor)
  }
  doc.setDrawColor(0)
  doc.setFillColor(0)
  return step * 5 - gap
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
