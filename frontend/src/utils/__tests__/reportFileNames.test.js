import { describe, it, expect } from 'vitest'
import { durationLabel, singleReportFileName, zipFileName, uniqueNames } from '../reportFileNames'

describe('report file names', () => {
  it('names a whole month by month', () => {
    expect(durationLabel({ date_from: '2026-11-01', date_to: '2026-11-30' })).toBe('Nov 2026')
    expect(durationLabel({ date_from: '2026-02-01', date_to: '2026-02-28' })).toBe('Feb 2026')
  })
  it('names custom dates and academic year', () => {
    expect(durationLabel({ date_from: '2026-11-01', date_to: '2026-11-20' })).toBe('01 Nov-20 Nov 2026')
    expect(durationLabel({ date_from: '2026-12-20', date_to: '2027-01-10' })).toBe('20 Dec 2026-10 Jan 2027')
    expect(durationLabel({ academic_year: 3 }, '2026-27')).toBe('AY 2026-27')
  })
  it('builds the single pdf name', () => {
    const s = { roll_number: '6', name: 'Muhammad Rahaim', class_name: 'Class 2 - A' }
    expect(singleReportFileName(s, 'Oct 2026')).toBe('6 - Muhammad Rahaim - Class 2-A (Oct 2026).pdf')
    expect(singleReportFileName({ name: 'A/B' }, 'Oct 2026')).toBe('AB (Oct 2026).pdf')
  })
  it('builds the zip name', () => {
    const a = { class_name: 'Class 2 - A' }
    expect(zipFileName([a, a], 'Oct 2026')).toBe('Class 2-A - (Oct 2026) - 2 reports.zip')
    expect(zipFileName([a], 'Oct 2026')).toBe('Class 2-A - (Oct 2026) - 1 report.zip')
    expect(zipFileName([a, { class_name: 'Class 3' }], 'Oct 2026')).toContain('Multiple classes')
  })
  it('keeps colliding entries distinct', () => {
    expect(uniqueNames(['a.pdf', 'a.pdf', 'b.pdf'])).toEqual(['a.pdf', 'a [2].pdf', 'b.pdf'])
  })
})
