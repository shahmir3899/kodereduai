import { describe, it, expect } from 'vitest'
import {
  compareRollNumbers,
  buildClassFilterOptions,
  filterStudents,
  sortStudents,
  computeStats,
  summarizeByGender,
  buildClassChipData,
} from '../studentListUtils'

const s = (over) => ({
  id: 1, name: 'A', roll_number: '1', class_obj: 1, class_name: 'Class 1', is_active: true, gender: 'M', ...over,
})

const sessionClasses = [
  { id: 10, class_obj: 1, display_name: 'Class 1', section: 'A', label: 'Class 1 - A', grade_level: 1 },
  { id: 11, class_obj: 1, display_name: 'Class 1', section: 'B', label: 'Class 1 - B', grade_level: 1 },
  { id: 12, class_obj: 2, display_name: 'Class 2', section: '', grade_level: 2 },
]

describe('compareRollNumbers', () => {
  it('orders numerically, not as text', () => {
    expect(['10', '9', '2'].sort(compareRollNumbers)).toEqual(['2', '9', '10'])
  })

  it('puts numeric rolls before non-numeric ones', () => {
    expect(['B1', '3', 'A2', '1'].sort(compareRollNumbers)).toEqual(['1', '3', 'A2', 'B1'])
  })

  it('treats blank as non-numeric', () => {
    expect(compareRollNumbers('', '5')).toBeGreaterThan(0)
  })
})

describe('buildClassFilterOptions', () => {
  it('uses session classes (with section labels) when in session scope', () => {
    const options = buildClassFilterOptions({ scope: 'session', sessionClasses, classes: [] })
    expect(options.map((o) => o.label)).toEqual(['Class 1 - A', 'Class 1 - B', 'Class 2'])
    expect(options.map((o) => o.id)).toEqual(['10', '11', '12'])
  })

  it('uses master classes otherwise', () => {
    const options = buildClassFilterOptions({
      scope: 'master',
      sessionClasses,
      classes: [{ id: 5, name: 'Class 5', grade_level: 5 }],
    })
    expect(options).toEqual([{ id: '5', label: 'Class 5' }])
  })

  it('drops session classes without a master class', () => {
    const options = buildClassFilterOptions({
      scope: 'session',
      sessionClasses: [{ id: 1, class_obj: null, display_name: 'X' }],
      classes: [],
    })
    expect(options).toEqual([])
  })
})

describe('filterStudents', () => {
  const base = { selectedClassIds: [], resolvedSelectedClasses: [], scope: 'master', sessionClasses: [], search: '', showInactive: false }
  const students = [
    s({ id: 1, name: 'Ali Hassan', roll_number: '1' }),
    s({ id: 2, name: 'Sara Khan', roll_number: '2', class_obj: 2 }),
    s({ id: 3, name: 'Zed Gone', roll_number: '3', is_active: false }),
  ]

  it('hides inactive students unless asked', () => {
    expect(filterStudents({ ...base, students }).map((x) => x.id)).toEqual([1, 2])
    expect(filterStudents({ ...base, students, showInactive: true }).map((x) => x.id)).toEqual([1, 2, 3])
  })

  it('matches search on name or roll number, case-insensitively', () => {
    expect(filterStudents({ ...base, students, search: 'SARA' }).map((x) => x.id)).toEqual([2])
    expect(filterStudents({ ...base, students, search: '1' }).map((x) => x.id)).toEqual([1])
  })

  it('filters by master class in master scope', () => {
    const out = filterStudents({ ...base, students, selectedClassIds: ['2'], resolvedSelectedClasses: ['2'] })
    expect(out.map((x) => x.id)).toEqual([2])
  })

  describe('session scope', () => {
    const pupils = [
      s({ id: 1, session_class_obj: 10, class_obj: 1 }),
      s({ id: 2, session_class_obj: 11, class_obj: 1 }),
      s({ id: 3, class_obj: 2 }),
    ]
    const session = { ...base, scope: 'session', sessionClasses }

    it('prefers the exact session class so sections sharing a master class stay apart', () => {
      const out = filterStudents({ ...session, students: pupils, selectedClassIds: ['10'], resolvedSelectedClasses: ['1'] })
      expect(out.map((x) => x.id)).toEqual([1])
    })

    it('falls back to the master class for an unsectioned class without annotation', () => {
      const out = filterStudents({ ...session, students: pupils, selectedClassIds: ['12'], resolvedSelectedClasses: ['2'] })
      expect(out.map((x) => x.id)).toEqual([3])
    })

    it('does not fall back to the master class when the class has a section', () => {
      const out = filterStudents({
        ...session,
        students: [s({ id: 9, class_obj: 1 })],
        selectedClassIds: ['10'],
        resolvedSelectedClasses: ['1'],
      })
      expect(out).toEqual([])
    })
  })
})

describe('sortStudents', () => {
  const classGradeMap = { 1: 1, 2: 2 }

  it('sorts by roll then name when a single class is selected', () => {
    const out = sortStudents(
      [s({ id: 1, roll_number: '10' }), s({ id: 2, roll_number: '2' }), s({ id: 3, roll_number: '2', name: '0 first' })],
      { selectedClassIds: ['1'], resolvedSelectedClasses: ['1'], classGradeMap },
    )
    expect(out.map((x) => x.id)).toEqual([3, 2, 1])
  })

  it('groups by grade level, then class name, then roll when not on a single class', () => {
    const out = sortStudents(
      [
        s({ id: 1, class_obj: 2, class_name: 'Class 2', roll_number: '1' }),
        s({ id: 2, class_obj: 1, class_name: 'Class 1', roll_number: '5' }),
        s({ id: 3, class_obj: 1, class_name: 'Class 1', roll_number: '4' }),
      ],
      { selectedClassIds: [], resolvedSelectedClasses: [], classGradeMap },
    )
    expect(out.map((x) => x.id)).toEqual([3, 2, 1])
  })

  it('sends unknown grade levels last', () => {
    const out = sortStudents(
      [s({ id: 1, class_obj: 99 }), s({ id: 2, class_obj: 1 })],
      { selectedClassIds: [], resolvedSelectedClasses: [], classGradeMap },
    )
    expect(out.map((x) => x.id)).toEqual([2, 1])
  })
})

describe('computeStats / summarizeByGender', () => {
  it('counts current, left and classes', () => {
    const stats = computeStats([s({}), s({ id: 2, class_name: 'Class 2' }), s({ id: 3, is_active: false, class_name: null })])
    expect(stats).toMatchObject({ total: 3, active: 2, inactive: 1 })
    expect(Object.keys(stats.byClass).sort()).toEqual(['Class 1', 'Class 2', 'Unassigned'])
  })

  it('counts withdrawn, transferred and graduated students as left even though their record is still on', () => {
    const stats = computeStats([
      s({ status: 'ACTIVE' }), s({ id: 2, status: 'WITHDRAWN' }), s({ id: 3, status: 'TRANSFERRED' }), s({ id: 4, status: 'GRADUATED' }),
    ])
    expect(stats).toMatchObject({ total: 4, active: 1, inactive: 3 })
  })

  it('buckets genders from codes and words', () => {
    const counts = summarizeByGender([
      s({ gender: 'M' }), s({ gender: 'male' }), s({ gender: 'F' }), s({ gender: 'Female' }), s({ gender: 'O' }), s({ gender: '' }), s({ gender: null }),
    ])
    expect(counts).toEqual({ male: 2, female: 2, other: 1, unknown: 2 })
  })
})

describe('buildClassChipData', () => {
  const students = [
    s({ id: 1, name: 'Ali', session_class_obj: 10, class_obj: 1 }),
    s({ id: 2, name: 'Sara', session_class_obj: 11, class_obj: 1 }),
    s({ id: 3, name: 'Alina', class_obj: 2 }),
  ]

  it('counts per session class in session scope', () => {
    const classFilterOptions = buildClassFilterOptions({ scope: 'session', sessionClasses, classes: [] })
    const chips = buildClassChipData({ allStudents: students, search: '', classFilterOptions, scope: 'session', sessionClasses })
    expect(chips).toEqual([
      { id: '10', name: 'Class 1 - A', count: 1 },
      { id: '11', name: 'Class 1 - B', count: 1 },
      { id: '12', name: 'Class 2', count: 1 },
    ])
  })

  it('counts per master class in master scope and applies the search', () => {
    const classes = [{ id: 1, name: 'Class 1', grade_level: 1 }, { id: 2, name: 'Class 2', grade_level: 2 }]
    const classFilterOptions = buildClassFilterOptions({ scope: 'master', sessionClasses: [], classes })
    const chips = buildClassChipData({ allStudents: students, search: 'ali', classFilterOptions, scope: 'master', sessionClasses: [] })
    expect(chips).toEqual([
      { id: '1', name: 'Class 1', count: 1 },
      { id: '2', name: 'Class 2', count: 1 },
    ])
  })

  it('shows empty classes with a zero count instead of dropping them', () => {
    const classFilterOptions = [{ id: '7', label: 'Class 7' }]
    const chips = buildClassChipData({ allStudents: students, search: '', classFilterOptions, scope: 'master', sessionClasses: [] })
    expect(chips).toEqual([{ id: '7', name: 'Class 7', count: 0 }])
  })
})
