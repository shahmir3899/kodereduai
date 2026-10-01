import { describe, it, expect } from 'vitest'
import { filterAssignments } from '../assignmentFilters'

// Fake in-memory rows only — nothing here touches the API or the database.
const rows = [
  { id: 1, title: 'Fractions homework', class_obj: 5, session_class: null, subject: 29, status: 'PUBLISHED', assignment_type: 'HOMEWORK' },
  { id: 2, title: 'Poem recitation', class_obj: 5, session_class: 15, subject: 30, status: 'DRAFT', assignment_type: 'CLASSWORK' },
  { id: 3, title: 'Science lab', class_obj: 5, session_class: 22, subject: 36, status: 'PUBLISHED', assignment_type: 'LAB' },
  { id: 4, title: 'Urdu diary', class_obj: 6, session_class: null, subject: 31, status: 'CLOSED', assignment_type: 'DIARY' },
]
const ids = (list) => list.map((a) => a.id)
const base = { sessionScoped: true }

describe('filterAssignments', () => {
  it('returns everything when no filter is set', () => {
    expect(ids(filterAssignments(rows, base))).toEqual([1, 2, 3, 4])
  })

  it('filters by master class', () => {
    expect(ids(filterAssignments(rows, { ...base, masterClassId: 6 }))).toEqual([4])
  })

  it('section view keeps whole-class rows and its own, never a sibling section', () => {
    const sectionA = filterAssignments(rows, { ...base, masterClassId: 5, sessionClassId: 15 })
    expect(ids(sectionA)).toEqual([1, 2])
    const sectionB = filterAssignments(rows, { ...base, masterClassId: 5, sessionClassId: 22 })
    expect(ids(sectionB)).toEqual([1, 3])
  })

  it('ignores the section when the selector is not session-scoped', () => {
    const out = filterAssignments(rows, { sessionScoped: false, masterClassId: 5, sessionClassId: 15 })
    expect(ids(out)).toEqual([1, 2, 3])
  })

  it('filters by subject, comparing ids as strings', () => {
    expect(ids(filterAssignments(rows, { ...base, subject: '36' }))).toEqual([3])
  })

  it('filters by status and type', () => {
    expect(ids(filterAssignments(rows, { ...base, status: 'PUBLISHED' }))).toEqual([1, 3])
    expect(ids(filterAssignments(rows, { ...base, type: 'DIARY' }))).toEqual([4])
  })

  it('searches the title case-insensitively', () => {
    expect(ids(filterAssignments(rows, { ...base, search: 'LAB' }))).toEqual([3])
  })

  it('combines filters with AND', () => {
    const out = filterAssignments(rows, { ...base, masterClassId: 5, sessionClassId: 22, status: 'PUBLISHED', type: 'HOMEWORK' })
    expect(ids(out)).toEqual([1])
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterAssignments(rows, { ...base, subject: '999' })).toEqual([])
  })
})
