import { describe, it, expect } from 'vitest'
import { addDays, formatDay, nextTermDefaults } from './termDefaults'

const year = { start_date: '2026-09-14', end_date: '2027-09-22' }

describe('term form defaults', () => {
  it('formats days the way the API messages do', () => {
    expect(formatDay('2026-09-14')).toBe('14 Sep 2026')
    expect(formatDay('')).toBe('')
  })

  it('adds days across month and year ends without timezone drift', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01')
  })

  it('starts the first term on the academic year start', () => {
    expect(nextTermDefaults(year, [])).toEqual({ order: 1, start_date: '2026-09-14' })
  })

  it('starts a later term the day after the previous one ends', () => {
    const terms = [
      { order: 1, end_date: '2026-11-30' },
      { order: 2, end_date: '2027-02-28' },
    ]
    expect(nextTermDefaults(year, terms)).toEqual({ order: 3, start_date: '2027-03-01' })
  })

  it('leaves the start empty once the year is fully covered, and copes with no year', () => {
    expect(nextTermDefaults(year, [{ order: 1, end_date: '2027-09-22' }]).start_date).toBe('')
    expect(nextTermDefaults(null, [])).toEqual({ order: 1, start_date: '' })
  })
})
