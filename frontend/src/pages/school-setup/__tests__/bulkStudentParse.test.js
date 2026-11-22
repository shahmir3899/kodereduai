import { describe, it, expect } from 'vitest'
import { parseBulkStudents, buildBulkPayload, bulkErrorMessage, BULK_MAX_ROWS } from '../bulkStudentParse'

describe('parseBulkStudents', () => {
  it('builds rows the backend serializer accepts (roll_number + name)', () => {
    const { students, problems } = parseBulkStudents('1, Ahmed Khan\n2, Fatima Ali, Mr Ali, 0300')
    expect(problems).toEqual([])
    expect(students).toEqual([
      { roll_number: '1', name: 'Ahmed Khan' },
      { roll_number: '2', name: 'Fatima Ali', parent_name: 'Mr Ali', parent_phone: '0300' },
    ])
  })

  it('flags missing roll, missing name and duplicate rolls by line', () => {
    const { students, problems } = parseBulkStudents(', Nobody\n3\n4, A\n4, B')
    expect(students).toHaveLength(1)
    expect(problems).toEqual([
      'Line 1: roll number is missing.',
      'Line 2: name is missing.',
      'Line 4: roll number 4 appears twice.',
    ])
  })

  it('rejects more than the backend cap', () => {
    const text = Array.from({ length: BULK_MAX_ROWS + 1 }, (_, i) => `${i + 1}, S${i}`).join('\n')
    expect(parseBulkStudents(text).problems[0]).toMatch(/Too many lines/)
  })
})

describe('buildBulkPayload', () => {
  it('includes school_id and class_id, and session_class_id only when given', () => {
    const students = [{ roll_number: '1', name: 'A' }]
    expect(buildBulkPayload({ schoolId: 7, classId: '3', students })).toEqual({ school_id: 7, class_id: 3, students })
    expect(buildBulkPayload({ schoolId: 7, classId: '3', sessionClassId: '9', students }).session_class_id).toBe(9)
  })
})

describe('bulkErrorMessage', () => {
  it('flattens DRF field errors', () => {
    expect(bulkErrorMessage({ school_id: ['This field is required.'] })).toBe('This field is required.')
    expect(bulkErrorMessage({ detail: 'Nope' })).toBe('Nope')
    expect(bulkErrorMessage(undefined)).toBe('Bulk import failed')
  })
})
