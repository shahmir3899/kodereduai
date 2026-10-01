import { describe, it, expect } from 'vitest'
import {
  findPeriod, matchAssignment, sectionParams, manualEntryClassId, countOf, buildTeacherAttentionItems,
} from '../teacherDashboardUtils'

const at = (h, m) => new Date(2026, 9, 1, h, m)
const TT = [
  { id: 1, slot_start_time: '08:00:00', slot_end_time: '08:40:00' },
  { id: 2, slot_start_time: '09:00:00', slot_end_time: '09:40:00' },
]

describe('findPeriod', () => {
  it('is "now" inside a period with minutes remaining', () => {
    expect(findPeriod(TT, at(8, 10))).toEqual({ index: 0, state: 'now', minutes: 30 })
  })
  it('is "next" between periods, with minutes until it starts', () => {
    expect(findPeriod(TT, at(8, 50))).toEqual({ index: 1, state: 'next', minutes: 10 })
  })
  it('treats the end minute as the period being over', () => {
    expect(findPeriod(TT, at(8, 40)).state).toBe('next')
  })
  it('is null after the last period or with no timetable', () => {
    expect(findPeriod(TT, at(15, 0)).state).toBeNull()
    expect(findPeriod([], at(9, 0)).state).toBeNull()
  })
  it('ignores slots with no times', () => {
    expect(findPeriod([{ slot_start_time: null, slot_end_time: null }], at(0, 0)).state).toBeNull()
  })
})

describe('matchAssignment', () => {
  const A = [
    { id: 1, class_obj: 5, session_class: 51 },
    { id: 2, class_obj: 6, session_class: null },
  ]
  it('matches a section entry only to that exact section', () => {
    expect(matchAssignment({ class_obj: 5, session_class: 51 }, A)?.id).toBe(1)
    expect(matchAssignment({ class_obj: 5, session_class: 52 }, A)).toBeNull()
  })
  it('matches a shared entry on the master class', () => {
    expect(matchAssignment({ class_obj: 6, session_class: null }, A)?.id).toBe(2)
  })
  it('returns null for no entry or no match', () => {
    expect(matchAssignment(null, A)).toBeNull()
    expect(matchAssignment({ class_obj: 9 }, A)).toBeNull()
  })
})

describe('sectionParams / manualEntryClassId', () => {
  it('scopes to the section when there is a session class', () => {
    expect(sectionParams({ session_class: 51, class_obj: 5 }, 7)).toEqual({ session_class_id: 51, academic_year: 7 })
    expect(manualEntryClassId({ session_class: 51, class_obj: 5 })).toBe(51)
  })
  it('falls back to the master class for legacy assignments', () => {
    expect(sectionParams({ session_class: null, class_obj: 5 })).toEqual({ class_id: 5 })
    expect(manualEntryClassId({ session_class: null, class_obj: 5 })).toBe(5)
  })
})

describe('countOf', () => {
  it('prefers the paginated count', () => expect(countOf({ data: { count: 42, results: [1] } })).toBe(42))
  it('counts plain arrays and results lists', () => {
    expect(countOf({ data: [1, 2] })).toBe(2)
    expect(countOf({ data: { results: [1, 2, 3] } })).toBe(3)
  })
  it('returns null (not 0) when there is no data', () => expect(countOf(undefined)).toBeNull())
})

describe('buildTeacherAttentionItems', () => {
  it('hides zero and unknown counts', () => {
    expect(buildTeacherAttentionItems({ pendingAttendanceClasses: 0, submissionsToGrade: undefined })).toEqual([])
  })
  it('drops the attendance chip on an off day', () => {
    const items = buildTeacherAttentionItems({ isOffDay: true, pendingAttendanceClasses: 2, submissionsToGrade: 1 })
    expect(items.map((i) => i.key)).toEqual(['grade'])
  })
  it('adds an in-page chip for at-risk students, hidden at zero', () => {
    expect(buildTeacherAttentionItems({ studentsAtRisk: 3 })).toEqual([
      { key: 'risk', count: 3, label: 'students at risk in your classes', href: '#students-at-risk', tone: 'amber' },
    ])
    expect(buildTeacherAttentionItems({ studentsAtRisk: 0 })).toEqual([])
  })
  it('respects disabled modules', () => {
    const items = buildTeacherAttentionItems({
      attendanceOn: false, examsOn: false, pendingAttendanceClasses: 1, examsAwaitingMarks: 2, submissionsToGrade: 3,
    })
    expect(items.map((i) => i.key)).toEqual(['grade'])
  })
})
