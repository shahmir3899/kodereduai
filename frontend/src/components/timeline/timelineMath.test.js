import { describe, it, expect } from 'vitest'
import { findGaps, findOverlaps, positionPercent, spanStyle, spansOverlap } from './timelineMath'

const t = (id, start_date, end_date) => ({ id, start_date, end_date })

describe('timeline maths', () => {
  it('places dates on the bar', () => {
    expect(positionPercent('2026-01-01', '2026-01-01', '2026-01-11')).toBe(0)
    expect(positionPercent('2026-01-06', '2026-01-01', '2026-01-11')).toBe(50)
    expect(positionPercent('2030-01-01', '2026-01-01', '2026-01-11')).toBe(100) // clamped
  })

  it('draws the end day as a whole day so back-to-back terms touch', () => {
    const a = spanStyle('2026-01-01', '2026-01-05', '2026-01-01', '2026-01-10')
    const b = spanStyle('2026-01-06', '2026-01-10', '2026-01-01', '2026-01-10')
    expect(a.left + a.width).toBeCloseTo(b.left)
    expect(b.left + b.width).toBeCloseTo(100)
  })

  it('treats a term starting on the previous end date as touching, not overlapping (matches the server)', () => {
    expect(spansOverlap(t(1, '2026-01-01', '2026-03-31'), t(2, '2026-03-31', '2026-06-30'))).toBe(false)
    expect(spansOverlap(t(1, '2026-01-01', '2026-04-01'), t(2, '2026-03-31', '2026-06-30'))).toBe(true)
  })

  it('lists every item involved in an overlap', () => {
    const ids = findOverlaps([t(1, '2026-01-01', '2026-04-01'), t(2, '2026-03-01', '2026-06-30'), t(3, '2026-09-01', '2026-12-01')])
    expect([...ids].sort()).toEqual([1, 2])
  })

  it('finds gaps before, between and after terms but none between consecutive days', () => {
    const gaps = findGaps(
      [t(1, '2026-01-05', '2026-01-10'), t(2, '2026-01-11', '2026-01-20'), t(3, '2026-02-01', '2026-02-05')],
      '2026-01-01', '2026-02-10',
    )
    expect(gaps.map(g => [g.start_date, g.end_date, g.days])).toEqual([
      ['2026-01-01', '2026-01-04', 4],
      ['2026-01-21', '2026-01-31', 11],
      ['2026-02-06', '2026-02-10', 5],
    ])
  })

  it('reports the whole range as one gap when there are no terms', () => {
    expect(findGaps([], '2026-01-01', '2026-01-10')).toHaveLength(1)
  })
})
