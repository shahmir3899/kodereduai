import { describe, it, expect } from 'vitest'
import { awayDaysInMonth, describeAway, isAwayOn, isoDay } from '../awayPeriods'

const march = { start: '2026-03-10', end: '2026-03-20' }

describe('isAwayOn', () => {
  it('is start-inclusive and end-exclusive', () => {
    expect(isAwayOn([march], '2026-03-09')).toBe(false)
    expect(isAwayOn([march], '2026-03-10')).toBe(true)
    expect(isAwayOn([march], '2026-03-19')).toBe(true)
    expect(isAwayOn([march], '2026-03-20')).toBe(false)
  })

  it('treats a period with no end as still away', () => {
    expect(isAwayOn([{ start: '2026-03-10', end: null }], '2030-01-01')).toBe(true)
  })

  it('handles no periods', () => {
    expect(isAwayOn([], '2026-03-10')).toBe(false)
    expect(isAwayOn(undefined, '2026-03-10')).toBe(false)
  })

  it('checks every period', () => {
    const periods = [march, { start: '2026-05-01', end: '2026-05-03' }]
    expect(isAwayOn(periods, '2026-05-02')).toBe(true)
    expect(isAwayOn(periods, '2026-04-02')).toBe(false)
  })
})

describe('awayDaysInMonth', () => {
  it('lists the days of the month inside a period (month is 0-indexed)', () => {
    expect([...awayDaysInMonth([march], 2026, 2, 31)]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
  })

  it('covers a whole month a period spans, and nothing outside it', () => {
    const period = { start: '2026-02-20', end: '2026-04-05' }
    expect(awayDaysInMonth([period], 2026, 2, 31).size).toBe(31)
    expect([...awayDaysInMonth([period], 2026, 1, 28)]).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28])
    expect([...awayDaysInMonth([period], 2026, 3, 30)]).toEqual([1, 2, 3, 4])
    expect(awayDaysInMonth([period], 2026, 4, 31).size).toBe(0)
  })

  it('returns an empty set without periods', () => {
    expect(awayDaysInMonth(undefined, 2026, 2, 31).size).toBe(0)
  })

  it('formats ISO days with zero padding', () => {
    expect(isoDay(2026, 0, 5)).toBe('2026-01-05')
    expect(isoDay(2026, 11, 31)).toBe('2026-12-31')
  })
})

describe('describeAway', () => {
  it('describes a finished period with its length and return day', () => {
    const text = describeAway({ start: '2026-03-01', end: '2026-03-20' })
    expect(text).toContain('19 days')
    expect(text).toContain('back on')
    expect(text).toMatch(/2026/)
  })

  it('uses the singular for one day', () => {
    expect(describeAway({ start: '2026-03-01', end: '2026-03-02' })).toContain('(1 day;')
  })

  it('says not yet back for an open period', () => {
    expect(describeAway({ start: '2026-03-01', end: null })).toMatch(/^since .*\(not yet back\)$/)
  })
})
