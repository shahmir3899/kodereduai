import { GENERIC_AVATAR_DATA_URL } from './genericAvatar'

// Passport-style portrait: height = width * 4/3.
export const PHOTO_ASPECT = 4 / 3

/**
 * Crops an already-loaded image to the frame's aspect ratio, centred ("cover"), so a
 * photo of any shape fills the frame without being stretched. Returns a JPEG data URL,
 * or null when the browser can't do it (no canvas, tainted canvas from a cross-origin
 * image) - the caller then draws the image as-is rather than dropping the photo.
 */
function coverCrop(img) {
  try {
    const sw = img.naturalWidth || img.width
    const sh = img.naturalHeight || img.height
    if (!sw || !sh) return null
    let cw = sw
    let ch = sw * PHOTO_ASPECT
    if (ch > sh) { ch = sh; cw = sh / PHOTO_ASPECT }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(cw)
    canvas.height = Math.round(ch)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.92)
  } catch {
    return null
  }
}

/**
 * Draws the student's photo in a mounted-print style frame: soft offset shadow, a bold
 * outer rule, a fine inner rule and corner brackets. With no photo on file (or one the
 * browser couldn't load - missing file, CORS) the generic avatar sits in the same frame,
 * so the layout never has an unexplained gap. Returns the frame's { width, height } so
 * templates can lay out around it.
 */
export function drawPhotoBox(doc, x, y, width, photo, opts = {}) {
  const { frameColor = [79, 70, 229], accentColor = [165, 160, 240] } = opts
  const height = width * PHOTO_ASPECT

  // Shadow: a plain offset grey block (no transparency, so it prints cleanly).
  doc.setFillColor(222, 224, 230)
  doc.rect(x + 1.2, y + 1.2, width, height, 'F')
  doc.setFillColor(255, 255, 255)
  doc.rect(x, y, width, height, 'F')

  const pad = 2.4
  const innerW = width - pad * 2
  const innerH = height - pad * 2
  if (photo) {
    const cropped = coverCrop(photo)
    doc.addImage(cropped || photo, cropped ? 'JPEG' : 'PNG', x + pad, y + pad, innerW, innerH)
  } else {
    doc.setFillColor(232, 234, 240)
    doc.rect(x + pad, y + pad, innerW, innerH, 'F')
    // The avatar is square: keep it square (bottom-aligned) rather than stretching it.
    doc.addImage(GENERIC_AVATAR_DATA_URL, 'PNG', x + pad, y + height - pad - innerW, innerW, innerW)
  }

  doc.setDrawColor(...frameColor)
  doc.setLineWidth(0.9)
  doc.rect(x, y, width, height)
  doc.setDrawColor(...accentColor)
  doc.setLineWidth(0.25)
  doc.rect(x + 1.5, y + 1.5, width - 3, height - 3)

  // Corner brackets just outside the outer rule.
  const o = 1.2
  const len = 3.5
  doc.setDrawColor(...frameColor)
  doc.setLineWidth(0.6)
  ;[[x, y, 1, 1], [x + width, y, -1, 1], [x, y + height, 1, -1], [x + width, y + height, -1, -1]].forEach(([cx, cy, dx, dy]) => {
    doc.line(cx - dx * o, cy - dy * o, cx - dx * o + dx * len, cy - dy * o)
    doc.line(cx - dx * o, cy - dy * o, cx - dx * o, cy - dy * o + dy * len)
  })
  return { width, height }
}
