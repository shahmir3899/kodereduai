import { describe, expect, it } from 'vitest'
import { clampDrag, isTap, panelRect, parseSpot, positionFor, spotFromDrop, yRange } from '../fabPosition'

const b = { width: 1200, height: 800, boxW: 56, boxH: 74, margin: 16, top: 16, bottomReserve: 16 }

describe('tap versus drag', () => {
  it('treats a small wobble as a click and a real move as a drag', () => {
    expect(isTap(0, 0)).toBe(true)
    expect(isTap(5, 5)).toBe(true)
    expect(isTap(9, 0)).toBe(false)
    expect(isTap(0, -30)).toBe(false)
  })
})

describe('placement', () => {
  it('puts the default spot bottom-right', () => {
    const { max } = yRange(b)
    expect(positionFor(null, b)).toEqual({ x: 1200 - 16 - 56, y: max })
  })

  it('snaps a drop to the nearer side and keeps the height', () => {
    expect(spotFromDrop(100, 300, b).side).toBe('left')
    expect(spotFromDrop(1000, 300, b).side).toBe('right')
    const back = positionFor(spotFromDrop(100, 300, b), b)
    expect(back.x).toBe(16)
    expect(back.y).toBeCloseTo(300)
  })

  it('never leaves the window', () => {
    expect(spotFromDrop(10, -500, b).yFrac).toBe(0)
    expect(spotFromDrop(10, 5000, b).yFrac).toBe(1)
    expect(clampDrag(-50, -50, b)).toEqual({ x: 0, y: 16 })
    expect(clampDrag(9000, 9000, b)).toEqual({ x: 1200 - 56, y: yRange(b).max })
  })

  it('reads good saved values and ignores bad ones', () => {
    expect(parseSpot('{"side":"left","yFrac":0.4}')).toEqual({ side: 'left', yFrac: 0.4 })
    expect(parseSpot('{"side":"top","yFrac":0.4}')).toBeNull()
    expect(parseSpot('nope')).toBeNull()
    expect(parseSpot(null)).toBeNull()
    expect(positionFor({ side: 'left', yFrac: 9 }, b).y).toBe(yRange(b).max)
  })
})

describe('panel beside the button', () => {
  it('opens above a button in the lower half, lined up with its right edge', () => {
    const fab = positionFor({ side: 'right', yFrac: 1 }, b)
    const r = panelRect(fab, b)
    expect(r.sheet).toBe(false)
    expect(r.top + r.height).toBeLessThan(fab.y)
    expect(r.left + r.width).toBe(fab.x + b.boxW)
  })

  it('opens below a button in the upper half, lined up with its left edge', () => {
    const fab = positionFor({ side: 'left', yFrac: 0 }, b)
    const r = panelRect(fab, b)
    expect(r.top).toBeGreaterThan(fab.y)
    expect(r.left).toBe(fab.x)
    expect(r.top + r.height).toBeLessThanOrEqual(b.height - 8)
  })

  it('always stays inside the window, even in a short one', () => {
    const short = { ...b, height: 420 }
    ;['left', 'right'].forEach((side) => [0, 0.5, 1].forEach((yFrac) => {
      const r = panelRect(positionFor({ side, yFrac }, short), short)
      expect(r.left).toBeGreaterThanOrEqual(8)
      expect(r.top).toBeGreaterThanOrEqual(8)
      expect(r.left + r.width).toBeLessThanOrEqual(short.width - 8)
      expect(r.top + r.height).toBeLessThanOrEqual(short.height - 8)
    }))
  })

  it('becomes a full-width sheet on a narrow screen', () => {
    const narrow = { ...b, width: 400, height: 700 }
    const r = panelRect(positionFor(null, narrow), narrow)
    expect(r.sheet).toBe(true)
    expect(r.left).toBe(8)
    expect(r.width).toBe(384)
  })
})
