import { describe, it, expect } from 'vitest'
import { buildStudentsSheetData, parseStudentRows } from '../studentExcel'

const classes = [
  { id: 1, name: 'Class 1' },
  { id: 2, name: 'Play Group' },
]
const HEADER = ['class_name', 'roll_number', 'student_name', 'parent_phone', 'parent_name']

describe('buildStudentsSheetData', () => {
  it('writes the school, class list and the header the uploader expects', () => {
    const data = buildStudentsSheetData({ schoolName: 'Focus', classes, students: [] })
    expect(data[0]).toEqual(['School: Focus'])
    expect(data[1]).toEqual(['Classes: Class 1 | Play Group'])
    expect(data[4]).toEqual(HEADER)
  })

  it('falls back to "Unknown" without a school name', () => {
    expect(buildStudentsSheetData({ classes, students: [] })[0]).toEqual(['School: Unknown'])
  })

  it('builds a blank template with sample rows for the first two classes when there are no students', () => {
    const data = buildStudentsSheetData({ schoolName: 'X', classes, students: [] })
    const rows = data.slice(5)
    expect(rows[0]).toEqual(['Class 1', '1', 'Student Name', '+923001234567', 'Parent Name'])
    expect(rows[1][0]).toBe('Play Group')
    expect(rows).toHaveLength(12)
  })

  it('exports existing students sorted by class then numeric roll', () => {
    const data = buildStudentsSheetData({
      schoolName: 'X',
      classes,
      students: [
        { class_name: 'Class 2', roll_number: '1', name: 'C', parent_phone: '', parent_name: '' },
        { class_name: 'Class 1', roll_number: '10', name: 'B', parent_phone: '+92300', parent_name: 'P' },
        { class_name: 'Class 1', roll_number: '2', name: 'A' },
      ],
    })
    expect(data.slice(5).map((r) => r[2])).toEqual(['A', 'B', 'C'])
    expect(data[6]).toEqual(['Class 1', '10', 'B', '+92300', 'P'])
  })

  it('round-trips: an exported sheet parses back to the same students', () => {
    const students = [{ class_name: 'Class 1', roll_number: '3', name: 'Ali', parent_phone: '+923001111111', parent_name: 'Sr' }]
    const parsed = parseStudentRows(buildStudentsSheetData({ schoolName: 'X', classes, students }), classes)
    expect(parsed.studentsByClass).toEqual({
      1: [{ roll_number: '3', name: 'Ali', parent_phone: '+923001111111', parent_name: 'Sr' }],
    })
  })
})

describe('parseStudentRows', () => {
  const sheet = (...rows) => [['School: X'], [], HEADER, ...rows]

  it('rejects an empty file', () => {
    expect(parseStudentRows([['x']], classes)).toEqual({ error: 'File is empty or invalid' })
  })

  it('rejects a file without the class_name header', () => {
    expect(parseStudentRows([['a', 'b'], ['1', '2']], classes).error).toMatch(/class_name/)
  })

  it('rejects a file missing a required column', () => {
    const rows = [['class_name', 'roll_number'], ['Class 1', '1']]
    expect(parseStudentRows(rows, classes).error).toMatch(/Missing required columns/)
  })

  it('groups students by class id and normalizes phone numbers', () => {
    const { studentsByClass, issues } = parseStudentRows(
      sheet(['Class 1', 1, 'Ali', '0300-1111111', 'Sr'], ['Play Group', '2', 'Sara', '', '']),
      classes,
    )
    expect(issues).toEqual([])
    expect(studentsByClass[1]).toEqual([{ roll_number: '1', name: 'Ali', parent_phone: '+923001111111', parent_name: 'Sr' }])
    expect(studentsByClass[2][0]).toMatchObject({ name: 'Sara', parent_phone: '' })
  })

  it('matches class names ignoring case, extra spaces and (as a fallback) all spaces', () => {
    const { studentsByClass } = parseStudentRows(
      sheet(['  class   1 ', '1', 'A', '', ''], ['playgroup', '1', 'B', '', '']),
      classes,
    )
    expect(Object.keys(studentsByClass).sort()).toEqual(['1', '2'])
  })

  it('reports unknown classes as issues with the spreadsheet row number', () => {
    const { studentsByClass, issues } = parseStudentRows(sheet(['Class 9', '1', 'Lost', '', '']), classes)
    expect(studentsByClass).toEqual({})
    expect(issues).toEqual(['Row 4: Unknown class "Class 9"'])
  })

  it('skips sample rows, blank rows and rows without a roll or name', () => {
    const { studentsByClass, issues } = parseStudentRows(
      sheet(
        ['Class 1', '1', 'Enter name here', '', ''],
        [],
        ['Class 1', '', 'No Roll', '', ''],
        ['Class 1', '5', '', '', ''],
        ['Enter class', '1', 'x', '', ''],
        ['Class 1', '7', 'Real', '', ''],
      ),
      classes,
    )
    expect(issues).toEqual([])
    expect(studentsByClass[1].map((x) => x.name)).toEqual(['Real'])
  })

  it('finds the header below instruction rows, in any column order', () => {
    const rows = [
      ['School: X'],
      ['student_name', 'class_name', 'roll_number'],
      ['Ali', 'Class 1', '4'],
    ]
    const { studentsByClass } = parseStudentRows(rows, classes)
    expect(studentsByClass[1]).toEqual([{ roll_number: '4', name: 'Ali', parent_phone: '', parent_name: '' }])
  })
})

describe('sections', () => {
  const sessionClasses = [
    { id: 11, class_obj: 5, label: 'Class 2 - A', display_name: 'Class 2', is_active: true },
    { id: 12, class_obj: 5, label: 'Class 2 - B', display_name: 'Class 2', is_active: true },
    { id: 13, class_obj: null, label: 'Orphan', display_name: 'Orphan', is_active: true },
  ]
  const withMaster = [...classes, { id: 5, name: 'Class 2' }]

  it('lists sections, not master classes, in the template when sections exist', () => {
    const data = buildStudentsSheetData({ schoolName: 'X', classes: withMaster, students: [], sessionClasses })
    expect(data[1]).toEqual(['Classes: Class 2 - A | Class 2 - B'])
    expect(data[5][0]).toBe('Class 2 - A')
    expect(data[6][0]).toBe('Class 2 - B')
  })

  it('imports a section name to its master class and section', () => {
    const rows = [['School: X'], HEADER, ['Class 2 - A', '1', 'Ali', '', ''], ['Class 2 - B', '1', 'Sara', '', '']]
    const { studentsByClass, issues } = parseStudentRows(rows, withMaster, sessionClasses)
    expect(issues).toEqual([])
    expect(Object.keys(studentsByClass).sort()).toEqual(['5:11', '5:12'])
    expect(studentsByClass['5:11'][0].name).toBe('Ali')
    expect(studentsByClass['5:12'][0].name).toBe('Sara')
  })

  it('round-trips two sections that share roll numbers without merging them', () => {
    const students = [
      { class_name: 'Class 2 - A', roll_number: '1', name: 'Ali' },
      { class_name: 'Class 2 - B', roll_number: '1', name: 'Sara' },
    ]
    const parsed = parseStudentRows(
      buildStudentsSheetData({ schoolName: 'X', classes: withMaster, students, sessionClasses }),
      withMaster,
      sessionClasses,
    )
    expect(parsed.studentsByClass['5:11']).toHaveLength(1)
    expect(parsed.studentsByClass['5:12']).toHaveLength(1)
  })

  it('still accepts a bare master class name from an older sheet', () => {
    const rows = [['School: X'], HEADER, ['Class 1', '1', 'Old', '', '']]
    const { studentsByClass } = parseStudentRows(rows, withMaster, sessionClasses)
    expect(Object.keys(studentsByClass)).toEqual(['1'])
  })

  it('does not offer a section that has no master class', () => {
    const rows = [['School: X'], HEADER, ['Orphan', '1', 'X', '', '']]
    const { issues } = parseStudentRows(rows, withMaster, sessionClasses)
    expect(issues).toEqual(['Row 3: Unknown class "Orphan"'])
  })
})

