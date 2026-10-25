import { describe, it, expect } from 'vitest'
import { countsAsViewing, isComplete, mergeRanges, percentPlayed, rangesTotal } from './guideProgressRules'

describe('guide progress rules', () => {
  it('merges overlapping and touching ranges and drops junk', () => {
    expect(mergeRanges([[10, 20], [0, 5], [18, 30], [5.2, 8], [3, 3], ['x', 4], null])).toEqual([[0, 8], [10, 30]])
  })

  it('totals seconds played without counting a replayed part twice', () => {
    expect(rangesTotal([[0, 30], [10, 40]], 100)).toBe(40)
    expect(rangesTotal([[0, 500]], 100)).toBe(100) // never more than the video
  })

  it('completes at 85% of seconds played, not before', () => {
    expect(isComplete([[0, 84]], 100)).toBe(false)
    expect(isComplete([[0, 85]], 100)).toBe(true)
    expect(isComplete([[0, 40], [50, 95]], 100)).toBe(true) // skipped a gap, still 85
  })

  it('earns nothing for dragging to the end', () => {
    // one tiny range at the end, as a jump would leave
    expect(isComplete([[99, 100]], 100)).toBe(false)
    expect(percentPlayed([[99, 100]], 100)).toBe(1)
  })

  it('never completes a video of unknown length', () => {
    expect(isComplete([[0, 50]], 0)).toBe(false)
    expect(isComplete([[0, 50]], NaN)).toBe(false)
  })

  describe('countsAsViewing', () => {
    const base = { prev: 10, now: 10.25, paused: false, seeking: false, rate: 1, visible: true }
    it('counts ordinary playback', () => expect(countsAsViewing(base)).toBe(true))
    it('ignores a paused, seeking or hidden video', () => {
      expect(countsAsViewing({ ...base, paused: true })).toBe(false)
      expect(countsAsViewing({ ...base, seeking: true })).toBe(false)
      expect(countsAsViewing({ ...base, visible: false })).toBe(false)
    })
    it('allows up to 2x speed and no more', () => {
      expect(countsAsViewing({ ...base, rate: 2 })).toBe(true)
      expect(countsAsViewing({ ...base, rate: 2.5 })).toBe(false)
    })
    it('ignores jumps forward and any step backwards', () => {
      expect(countsAsViewing({ ...base, now: 40 })).toBe(false)
      expect(countsAsViewing({ ...base, now: 5 })).toBe(false)
      expect(countsAsViewing({ ...base, prev: null })).toBe(false)
    })
  })
})
