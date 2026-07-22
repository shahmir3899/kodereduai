/**
 * Urdu/Arabic-script text in downloaded lesson plan PDFs rendered as unknown
 * glyphs / scrambled letters. Root cause: jsPDF's text() draws whatever
 * glyphs it's given, left-to-right, one at a time — it has no text-shaping
 * engine, so it can't join Arabic-script letters or apply bidi reordering.
 * A prior attempt pre-processed text with a JS reshaper + bidi library to
 * fake this, but that only holds up for isolated words — full sentences
 * (spacing, punctuation, mixed-direction runs) still came out scrambled,
 * and it has no path at all to a Nastaliq-style font (which needs real
 * OpenType contextual shaping, not character substitution).
 *
 * Fix: draw the Urdu text onto a <canvas> using Canvas2D's fillText(),
 * which — like the rest of the browser — runs the platform's real text
 * shaping engine (joining, ligatures, and native `direction: 'rtl'` bidi
 * reordering) and gets it right automatically. The canvas is never
 * inserted into the page, so unlike an html2canvas-of-a-DOM-node approach
 * there's no off-screen-positioning/visibility class of bugs to fight —
 * just measure text width for manual line-wrapping and paint it.
 */

const FONT_FAMILY = 'PDFNotoNastaliqUrdu'
const FONT_URL = '/fonts/NotoNastaliqUrdu-Regular.ttf'
const ARABIC_SCRIPT_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/
const MM_PER_PX = 25.4 / 96 // CSS px is defined as 1/96 inch

let fontFacePromise = null

export function containsArabicScript(text) {
  return ARABIC_SCRIPT_RE.test(String(text ?? ''))
}

function ensureArabicFontLoaded() {
  if (!fontFacePromise) {
    const fontFace = new FontFace(FONT_FAMILY, `url(${FONT_URL})`)
    fontFacePromise = fontFace.load().then((loaded) => {
      document.fonts.add(loaded)
      return loaded
    })
  }
  return fontFacePromise
}

/** Greedily wraps `text` into lines no wider than maxWidthPx, measured with the real font. */
function wrapLines(ctx, text, maxWidthPx) {
  const paragraphs = text.split('\n')
  const lines = []
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let current = words[0]
    for (let i = 1; i < words.length; i++) {
      const candidate = `${current} ${words[i]}`
      if (ctx.measureText(candidate).width <= maxWidthPx) {
        current = candidate
      } else {
        lines.push(current)
        current = words[i]
      }
    }
    lines.push(current)
  }
  return lines
}

/**
 * Renders Urdu/Arabic text to a PNG data URL sized to fit a given width,
 * using the browser's own text shaping. Returns dimensions in mm so the
 * result can be placed directly via jsPDF's doc.addImage at 1:1 scale.
 *
 * @param {string} text
 * @param {object} opts
 * @param {number} opts.maxWidthMm - target width in mm (matches the PDF content box)
 * @param {number} opts.fontSizePt - font size in points (jsPDF's text unit)
 * @param {[number, number, number]} [opts.color] - RGB 0-255
 * @param {'right'|'left'} [opts.align]
 * @returns {Promise<{ dataUrl: string, widthMm: number, heightMm: number }>}
 */
export async function renderArabicTextToImage(text, { maxWidthMm, fontSizePt, color = [0, 0, 0], align = 'right' }) {
  await ensureArabicFontLoaded()

  const scale = 3 // supersample for crisp print-quality output
  const widthPx = Math.round(maxWidthMm / MM_PER_PX)
  const fontSizePx = fontSizePt * (96 / 72)
  const lineHeightPx = Math.round(fontSizePx * 1.9)

  // Measure on a throwaway canvas first (needs a 2D context with the font set, but no
  // particular size) to compute how many lines the text wraps into.
  const measureCanvas = document.createElement('canvas')
  const measureCtx = measureCanvas.getContext('2d')
  measureCtx.font = `${fontSizePx}px "${FONT_FAMILY}"`
  measureCtx.direction = 'rtl'
  const lines = wrapLines(measureCtx, String(text ?? ''), widthPx)

  const heightPx = Math.max(lines.length, 1) * lineHeightPx
  const canvas = document.createElement('canvas')
  canvas.width = widthPx * scale
  canvas.height = heightPx * scale
  const ctx = canvas.getContext('2d')
  ctx.scale(scale, scale)
  ctx.font = `${fontSizePx}px "${FONT_FAMILY}"`
  ctx.direction = 'rtl'
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  ctx.fillStyle = `rgb(${color.join(',')})`

  // Each line is centered within its own lineHeightPx band (not anchored to its top) so the
  // rendered ink fills the image vertically instead of leaving slack at the bottom — Nastaliq's
  // tall ascent/descent metrics otherwise leave a lot of unused space below a top-anchored line.
  const anchorX = align === 'right' ? widthPx : align === 'center' ? widthPx / 2 : 0
  lines.forEach((line, i) => {
    ctx.fillText(line, anchorX, i * lineHeightPx + lineHeightPx / 2)
  })

  return {
    dataUrl: canvas.toDataURL('image/png'),
    widthMm: maxWidthMm,
    heightMm: heightPx * MM_PER_PX,
  }
}
