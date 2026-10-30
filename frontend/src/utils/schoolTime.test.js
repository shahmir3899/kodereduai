import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  setSchoolTimeZone, schoolToday, schoolDateStr, schoolPeriod, schoolNowDate, getSchoolTimeZone, DEFAULT_SCHOOL_TIME_ZONE,
} from './schoolTime'

// 21:00 UTC on 29 Oct = 02:00 on 30 Oct in Karachi, still the evening of 29 Oct in New York
const INSTANT = new Date('2026-10-29T21:00:00Z')

afterEach(() => {
  vi.useRealTimers()
  setSchoolTimeZone(undefined)
})

describe('schoolTime', () => {
  it('defaults to Pakistan time and ignores an unknown zone', () => {
    setSchoolTimeZone('Mars/Olympus')
    expect(getSchoolTimeZone()).toBe(DEFAULT_SCHOOL_TIME_ZONE)
  })

  it("reads today on the school's calendar, not UTC", () => {
    vi.useFakeTimers()
    vi.setSystemTime(INSTANT)
    expect(schoolToday()).toBe('2026-10-30')
    setSchoolTimeZone('America/New_York')
    expect(schoolToday()).toBe('2026-10-29')
  })

  it('formats a given instant in the school zone', () => {
    expect(schoolDateStr(INSTANT, 'Asia/Karachi')).toBe('2026-10-30')
    expect(schoolDateStr(INSTANT, 'America/New_York')).toBe('2026-10-29')
  })

  it("gives a Date whose local fields read the school's wall clock", () => {
    vi.useFakeTimers()
    vi.setSystemTime(INSTANT)
    const karachi = schoolNowDate()
    expect([karachi.getFullYear(), karachi.getMonth() + 1, karachi.getDate(), karachi.getHours()]).toEqual([2026, 10, 30, 2])
    setSchoolTimeZone('America/New_York')
    const ny = schoolNowDate()
    expect([ny.getMonth() + 1, ny.getDate(), ny.getHours()]).toEqual([10, 29, 17])
  })

  it('builds report periods from the school calendar', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2027-01-01T00:30:00Z')) // 05:30 on 1 Jan in Karachi, 31 Dec in New York
    expect(schoolPeriod('month')).toEqual({ date_from: '2027-01-01', date_to: '2027-01-01' })
    expect(schoolPeriod('lastMonth')).toEqual({ date_from: '2026-12-01', date_to: '2026-12-31' })
    expect(schoolPeriod('year')).toEqual({ date_from: '2027-01-01', date_to: '2027-01-01' })
    setSchoolTimeZone('America/New_York')
    expect(schoolPeriod('month')).toEqual({ date_from: '2026-12-01', date_to: '2026-12-31' })
    expect(schoolPeriod('quarter').date_from).toBe('2026-10-01')
  })
})
