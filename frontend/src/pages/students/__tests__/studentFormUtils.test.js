import { describe, it, expect } from 'vitest'
import {
  normalizeGender,
  parsePhone,
  emptyStudentForm,
  studentToForm,
  formToPayload,
  getChangedPayload,
  validateStudentForm,
  parseDrfErrors,
} from '../studentFormUtils'
import { STUDENT_FIELD_NAMES, STUDENT_FIELDS, STUDENT_SECTIONS, fieldsInSection } from '../studentFieldConfig'

const student = {
  id: 7,
  name: 'Ali Hassan',
  roll_number: '4',
  parent_phone: '0300-1111111',
  parent_name: 'Hassan Sr',
  gender: 'Male',
  date_of_birth: '2015-04-02',
  admission_date: null,
  guardian_email: 'g@example.com',
  class_obj: 3,
  status: 'ACTIVE',
}

const drfError = (data, status = 400) => ({ response: { status, data } })

describe('studentFieldConfig', () => {
  it('puts every field in a known section and names are unique', () => {
    const sections = new Set(STUDENT_SECTIONS.map((s) => s.key))
    expect(STUDENT_FIELDS.every((f) => sections.has(f.section))).toBe(true)
    expect(new Set(STUDENT_FIELD_NAMES).size).toBe(STUDENT_FIELD_NAMES.length)
  })

  it('never exposes class or status fields (those go through reclassify / status actions)', () => {
    for (const forbidden of ['class_obj', 'status', 'status_date', 'status_reason', 'is_active']) {
      expect(STUDENT_FIELD_NAMES).not.toContain(forbidden)
    }
  })

  it('marks exactly the fields the compact Add form shows', () => {
    expect(STUDENT_FIELDS.filter((f) => f.quick).map((f) => f.name)).toEqual([
      'name', 'roll_number', 'parent_name', 'parent_phone',
    ])
  })

  it('lists the fields of a section', () => {
    expect(fieldsInSection('basic').map((f) => f.name)).toEqual(['name', 'roll_number'])
  })
})

describe('normalizeGender', () => {
  it.each([
    ['Male', 'M'], ['female', 'F'], ['OTHER', 'O'], ['m', 'M'], ['', ''], [null, ''], ['x', ''],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeGender(input)).toBe(expected)
  })
})

describe('parsePhone', () => {
  it.each([
    ['0300-1111111', '+923001111111'],
    ['3001111111', '+923001111111'],
    ['923001111111', '+923001111111'],
    ['+923001111111', '+923001111111'],
    ['P:0300 111 1111', '+923001111111'],
    ['', ''],
    [null, ''],
  ])('%s -> %s', (input, expected) => {
    expect(parsePhone(input)).toBe(expected)
  })

  it('expands scientific notation from Excel', () => {
    expect(parsePhone('3.001111111E9')).toBe('+923001111111')
  })

  it('keeps digits instead of wiping the number when an "e" is not a number', () => {
    expect(parsePhone('042-1234567 ext')).toBe('0421234567')
  })
})

describe('studentToForm / formToPayload', () => {
  it('creates an empty form with every field', () => {
    expect(Object.keys(emptyStudentForm()).sort()).toEqual([...STUDENT_FIELD_NAMES].sort())
  })

  it('maps a student to form values, normalizing gender and nulls', () => {
    const form = studentToForm(student)
    expect(form.name).toBe('Ali Hassan')
    expect(form.gender).toBe('M')
    expect(form.admission_date).toBe('')
    expect(form.guardian_phone).toBe('')
    expect(form).not.toHaveProperty('class_obj')
  })

  it('trims text, nulls empty dates and normalizes only parent_phone', () => {
    const payload = formToPayload({
      ...emptyStudentForm(),
      name: '  Sara  ',
      roll_number: ' 5 ',
      parent_phone: '0300-2222222',
      guardian_phone: '0300-3333333',
      date_of_birth: '',
      gender: 'Female',
    })
    expect(payload.name).toBe('Sara')
    expect(payload.roll_number).toBe('5')
    expect(payload.parent_phone).toBe('+923002222222')
    expect(payload.guardian_phone).toBe('0300-3333333')
    expect(payload.date_of_birth).toBeNull()
    expect(payload.gender).toBe('F')
  })
})

describe('getChangedPayload', () => {
  it('is empty when nothing changed, even though the stored phone is not in +92 format', () => {
    expect(getChangedPayload(student, studentToForm(student))).toEqual({})
  })

  it('returns only the fields that changed', () => {
    const values = { ...studentToForm(student), name: 'Ali H. Hassan', blood_group: 'O+' }
    expect(getChangedPayload(student, values)).toEqual({ name: 'Ali H. Hassan', blood_group: 'O+' })
  })

  it('sends null when a date is cleared', () => {
    const values = { ...studentToForm(student), date_of_birth: '' }
    expect(getChangedPayload(student, values)).toEqual({ date_of_birth: null })
  })

  it('ignores whitespace-only edits', () => {
    const values = { ...studentToForm(student), name: '  Ali Hassan ' }
    expect(getChangedPayload(student, values)).toEqual({})
  })
})

describe('validateStudentForm', () => {
  const base = studentToForm(student)

  it('requires name and roll number', () => {
    const errors = validateStudentForm({ ...base, name: ' ', roll_number: '' })
    expect(errors).toEqual({
      name: 'Student name is required',
      roll_number: 'Roll number is required',
    })
  })

  it('accepts a valid form', () => {
    expect(validateStudentForm(base)).toEqual({})
  })

  it('rejects a future date of birth and a bad guardian email when they are entered', () => {
    const errors = validateStudentForm(
      { ...base, date_of_birth: '2999-01-01', guardian_email: 'nope' },
      { today: new Date('2026-01-01') },
    )
    expect(errors.date_of_birth).toMatch(/future/)
    expect(errors.guardian_email).toMatch(/valid email/)
  })

  it('rejects an invalid phone and an over-long value', () => {
    const errors = validateStudentForm({ ...base, parent_phone: '12', blood_group: 'ABCDEFG' })
    expect(errors.parent_phone).toMatch(/valid phone/)
    expect(errors.blood_group).toMatch(/at most 5/)
  })

  it('does not block an edit over legacy values the user did not touch', () => {
    const legacy = { ...student, guardian_email: 'not-an-email', parent_phone: '12' }
    const values = { ...studentToForm(legacy), name: 'Renamed' }
    expect(validateStudentForm(values, { initial: legacy })).toEqual({})
  })

  it('still validates a legacy field once the user edits it', () => {
    const legacy = { ...student, guardian_email: 'not-an-email' }
    const values = { ...studentToForm(legacy), guardian_email: 'still-bad' }
    expect(validateStudentForm(values, { initial: legacy }).guardian_email).toMatch(/valid email/)
  })

  it('treats empty optional fields as fine', () => {
    expect(validateStudentForm({ ...base, parent_phone: '', guardian_email: '', date_of_birth: '' })).toEqual({})
  })
})

describe('parseDrfErrors', () => {
  it('splits field errors from non-field errors', () => {
    const result = parseDrfErrors(drfError({
      roll_number: ["Roll number '4' already exists in this class for 2025-2026."],
      guardian_email: ['Enter a valid email address.'],
      non_field_errors: ['Something else'],
    }))
    expect(result.fieldErrors).toEqual({
      roll_number: "Roll number '4' already exists in this class for 2025-2026.",
      guardian_email: 'Enter a valid email address.',
    })
    expect(result.formError).toBe('Something else')
    expect(result.conflict).toBeNull()
  })

  it('joins multiple messages for one field', () => {
    const result = parseDrfErrors(drfError({ name: ['Too long.', 'Bad chars.'] }))
    expect(result.fieldErrors.name).toBe('Too long., Bad chars.')
  })

  it('treats detail as a form-level error', () => {
    const result = parseDrfErrors(drfError({ detail: 'Not found.' }, 404))
    expect(result).toMatchObject({ fieldErrors: {}, formError: 'Not found.' })
  })

  it('keeps errors for fields outside the form (such as status_date) as field errors', () => {
    const result = parseDrfErrors(drfError({ status_date: ['Pick a later date.'] }))
    expect(result.fieldErrors).toEqual({ status_date: 'Pick a later date.' })
  })

  it('passes the leaving-conflict body through untouched', () => {
    const body = { code: 'records_after_leaving', detail: 'x', attendance_count: 3 }
    const result = parseDrfErrors(drfError(body))
    expect(result).toEqual({ fieldErrors: {}, formError: null, conflict: body })
  })

  it('reports a network error as a form error', () => {
    const result = parseDrfErrors({ message: 'Network Error' }, 'Failed to save')
    expect(result.formError).toMatch(/network error/i)
    expect(result.fieldErrors).toEqual({})
  })

  it('reports an HTML 500 body as a form error, not field errors', () => {
    const result = parseDrfErrors(drfError('<!DOCTYPE html><html></html>', 500))
    expect(result.formError).toMatch(/server error/i)
    expect(result.fieldErrors).toEqual({})
  })
})
