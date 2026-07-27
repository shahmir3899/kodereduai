import { describe, it, expect } from 'vitest'
import { buildDateSheetGrid, buildDateRange, buildSubjectPoolByExam } from '../ExamsPage'

// Mirrors backend/examinations/views.py::_build_date_sheet_grid — this is the
// client-side pivot used to render the read-only Calendar view from the same
// payload the editable Table view already fetches (GET .../date-sheet/).

const SUBJECTS = [
  {
    subject_id: 1,
    subject_name: 'Mathematics',
    subject_code: 'MATH',
    classes: [
      { exam_subject_id: 10, exam_id: 100, class_name: 'Class 1 - A', exam_date: '2026-04-01', start_time: null, end_time: null },
      { exam_subject_id: 11, exam_id: 200, class_name: 'Class 2 - B', exam_date: '2026-04-01', start_time: null, end_time: null },
    ],
  },
  {
    subject_id: 2,
    subject_name: 'English',
    subject_code: 'ENG',
    classes: [
      { exam_subject_id: 12, exam_id: 100, class_name: 'Class 1 - A', exam_date: '2026-04-01', start_time: null, end_time: null },
      { exam_subject_id: 13, exam_id: 200, class_name: 'Class 2 - B', exam_date: null, start_time: null, end_time: null },
    ],
  },
]

describe('buildDateSheetGrid', () => {
  it('pivots into one row per date, one column per class, preserving input class order', () => {
    const grid = buildDateSheetGrid(SUBJECTS)

    expect(grid.columns.map(c => c.examId)).toEqual([100, 200])
    expect(grid.columns.map(c => c.label)).toEqual(['Class 1 - A', 'Class 2 - B'])

    expect(grid.rows).toHaveLength(1)
    expect(grid.rows[0].date).toBe('2026-04-01')
  })

  it('computes the day name in a timezone-safe way', () => {
    const grid = buildDateSheetGrid(SUBJECTS)
    // 2026-04-01 is a Wednesday, regardless of the machine's local timezone.
    expect(grid.rows[0].dayName).toBe('Wednesday')
  })

  it('joins two subjects sharing the same date+class into one cell', () => {
    const grid = buildDateSheetGrid(SUBJECTS)
    // Class 1 - A (examId 100) has both Math and English on 2026-04-01.
    expect(grid.rows[0].cells[100]).toBe('Mathematics / English')
  })

  it('leaves a class blank on a date it has no exam for', () => {
    const grid = buildDateSheetGrid(SUBJECTS)
    // Class 2 - B (examId 200) only has Math on 2026-04-01, not English.
    expect(grid.rows[0].cells[200]).toBe('Mathematics')
  })

  it('lists subjects with no exam_date as unscheduled instead of dropping them', () => {
    const grid = buildDateSheetGrid(SUBJECTS)
    expect(grid.unscheduled).toEqual([
      { subjectName: 'English', className: 'Class 2 - B' },
    ])
  })

  it('returns an empty grid for no subjects', () => {
    const grid = buildDateSheetGrid([])
    expect(grid).toEqual({ columns: [], rows: [], unscheduled: [] })
  })
})

describe('buildDateRange', () => {
  it('lists every calendar day inclusive of both bounds, in a timezone-safe way', () => {
    expect(buildDateRange('2026-04-01', '2026-04-03')).toEqual([
      '2026-04-01', '2026-04-02', '2026-04-03',
    ])
  })

  it('returns a single day when start equals end', () => {
    expect(buildDateRange('2026-04-01', '2026-04-01')).toEqual(['2026-04-01'])
  })

  it('returns [] when either bound is missing', () => {
    expect(buildDateRange('', '2026-04-03')).toEqual([])
    expect(buildDateRange('2026-04-01', '')).toEqual([])
  })

  it('returns [] when end is before start', () => {
    expect(buildDateRange('2026-04-03', '2026-04-01')).toEqual([])
  })
})

describe('buildSubjectPoolByExam', () => {
  it('groups each class exam_id to its own list of exam-subject records', () => {
    const pool = buildSubjectPoolByExam(SUBJECTS)
    expect(Object.keys(pool).map(Number).sort()).toEqual([100, 200])
    expect(pool[100]).toEqual([
      { examSubjectId: 10, subjectName: 'Mathematics', examDate: '2026-04-01' },
      { examSubjectId: 12, subjectName: 'English', examDate: '2026-04-01' },
    ])
  })

  it('represents an unscheduled subject with an empty examDate rather than null', () => {
    const pool = buildSubjectPoolByExam(SUBJECTS)
    expect(pool[200]).toContainEqual({ examSubjectId: 13, subjectName: 'English', examDate: '' })
  })

  it('returns an empty pool for no subjects', () => {
    expect(buildSubjectPoolByExam([])).toEqual({})
  })
})
