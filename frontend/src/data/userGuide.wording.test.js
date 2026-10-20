import { describe, it, expect } from 'vitest'
import guide from './userGuide.json'

const find = (id) => {
  let hit = null
  const walk = (o) => {
    if (hit) return
    if (Array.isArray(o)) return o.forEach(walk)
    if (o && typeof o === 'object') {
      if (String(o.id) === id && o.content) { hit = JSON.stringify(o); return }
      Object.values(o).forEach(walk)
    }
  }
  walk(guide)
  return hit
}

// The finance guide sections once described a UI that no longer exists (found while recording the tutorial videos).
describe('finance guide wording matches the real labels', () => {
  it('7.1 uses "Visible to Staff"', () => {
    const t = find('7.1')
    expect(t).toContain('Visible to Staff')
    expect(t).not.toContain('Staff Visible')
  })
  it('7.3 describes the four real tabs and the Review & Save / Confirm & Save flow', () => {
    const t = find('7.3')
    for (const label of ['Monthly Structure', 'Annual Charges', 'Generate Records', 'Student Discounts', 'Confirm & Save']) expect(t).toContain(label)
    expect(t).not.toContain('Review Changes')
  })
  it('7.4 uses the "Generate Single Fee Record" button', () => {
    const t = find('7.4')
    expect(t).toContain('Generate Single Fee Record')
    expect(t).not.toContain("Click 'Create Fee'")
  })
})
