// Position 1-3 get a trophy / medal banner; everything is vector primitives so it
// prints crisply and never depends on emoji font support in the PDF viewer.
const TIERS = {
  1: { label: 'FIRST POSITION', main: [201, 151, 20], dark: [150, 105, 10], soft: [253, 246, 224] },
  2: { label: 'SECOND POSITION', main: [128, 138, 150], dark: [88, 96, 108], soft: [243, 245, 248] },
  3: { label: 'THIRD POSITION', main: [176, 108, 60], dark: [128, 74, 36], soft: [250, 240, 232] },
}

export function podiumTier(rank) {
  return TIERS[rank] || null
}

function drawTrophy(doc, x, y, size, tier) {
  const s = size / 20
  doc.setFillColor(...tier.main)
  doc.setDrawColor(...tier.dark)
  doc.setLineWidth(1 * s)
  // handles: centred on the cup's edge so the cup body covers their inner half
  doc.ellipse(x + 4.5 * s, y + 5 * s, 3.2 * s, 3.4 * s, 'S')
  doc.ellipse(x + 15.5 * s, y + 5 * s, 3.2 * s, 3.4 * s, 'S')
  // cup
  doc.roundedRect(x + 4.5 * s, y, 11 * s, 11 * s, 1 * s, 1 * s, 'F')
  doc.triangle(x + 4.5 * s, y + 9 * s, x + 15.5 * s, y + 9 * s, x + 10 * s, y + 14 * s, 'F')
  // stem + base
  doc.rect(x + 9 * s, y + 13 * s, 2 * s, 3.5 * s, 'F')
  doc.setFillColor(...tier.dark)
  doc.roundedRect(x + 5.5 * s, y + 16.5 * s, 9 * s, 3.2 * s, 0.6 * s, 0.6 * s, 'F')
  // shine
  doc.setDrawColor(255, 255, 255)
  doc.setLineWidth(0.6 * s)
  doc.line(x + 7 * s, y + 2.5 * s, x + 7 * s, y + 8 * s)
}

function drawMedal(doc, x, y, size, tier, rank) {
  const s = size / 20
  doc.setFillColor(...tier.dark)
  // crossed ribbon tails hanging from the top, hidden behind the disc
  doc.triangle(x + 4 * s, y, x + 9 * s, y, x + 13 * s, y + 10 * s, 'F')
  doc.triangle(x + 16 * s, y, x + 11 * s, y, x + 7 * s, y + 10 * s, 'F')
  doc.setFillColor(...tier.main)
  doc.setDrawColor(...tier.dark)
  doc.setLineWidth(0.7 * s)
  doc.circle(x + 10 * s, y + 13.5 * s, 6 * s, 'FD')
  doc.setDrawColor(255, 255, 255)
  doc.setLineWidth(0.3 * s)
  doc.circle(x + 10 * s, y + 13.5 * s, 4.4 * s, 'S')
  doc.setFont(undefined, 'bold')
  doc.setFontSize(9 * s)
  doc.setTextColor(255, 255, 255)
  doc.text(String(rank), x + 10 * s, y + 16.2 * s, { align: 'center' })
  doc.setFont(undefined, 'normal')
}

/** Draws the banner and returns the y just below it. */
export function drawPodiumBanner(doc, { x, y, width, rank, className, percentage }) {
  const tier = TIERS[rank]
  if (!tier) return y
  const height = 22
  doc.setFillColor(...tier.soft)
  doc.setDrawColor(...tier.main)
  doc.setLineWidth(0.8)
  doc.roundedRect(x, y, width, height, 3, 3, 'FD')
  doc.setLineWidth(0.25)
  doc.roundedRect(x + 1.4, y + 1.4, width - 2.8, height - 2.8, 2.2, 2.2, 'S')

  const iconSize = 17
  if (rank === 1) drawTrophy(doc, x + 8, y + 2.5, iconSize, tier)
  else drawMedal(doc, x + 8, y + 2.5, iconSize, tier, rank)

  const tx = x + 8 + iconSize + 8
  doc.setFont(undefined, 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...tier.dark)
  doc.text(tier.label, tx, y + 10)
  doc.setFont(undefined, 'normal')
  doc.setFontSize(9)
  doc.setTextColor(90)
  const detail = [`Class ${className}`.replace(/^Class Class/i, 'Class'), percentage != null ? `${Number(percentage).toFixed(1)}%` : null]
    .filter(Boolean).join('  ·  ')
  doc.text(`Congratulations!  ${detail}`, tx, y + 16.5)

  // mirrored icon on the right for symmetry
  const rx = x + width - 8 - iconSize
  if (rank === 1) drawTrophy(doc, rx, y + 2.5, iconSize, tier)
  else drawMedal(doc, rx, y + 2.5, iconSize, tier, rank)
  doc.setTextColor(0)
  return y + height + 6
}
