import { GENERIC_AVATAR_DATA_URL } from './genericAvatar'

/**
 * Draws the student's photo in a square box, or - when there is no photo on
 * file, or the browser couldn't load it (missing file, CORS) - a generic
 * neutral avatar, so the layout never has an unexplained gap where a photo
 * should be.
 */
export function drawPhotoBox(doc, x, y, size, photo, opts = {}) {
  const { borderColor = [180, 180, 190] } = opts

  doc.addImage(photo || GENERIC_AVATAR_DATA_URL, 'PNG', x, y, size, size)
  doc.setDrawColor(...borderColor)
  doc.setLineWidth(0.3)
  doc.rect(x, y, size, size)
}
