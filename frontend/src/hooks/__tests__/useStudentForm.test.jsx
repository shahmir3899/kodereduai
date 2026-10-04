import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStudentForm } from '../useStudentForm'

const student = {
  name: 'Ali Hassan', roll_number: '4', parent_phone: '0300-1111111', gender: 'Male',
  guardian_email: 'g@example.com', date_of_birth: '2015-04-02',
}
const drfError = (data, status = 400) => ({ response: { status, data } })

describe('useStudentForm', () => {
  describe('edit mode', () => {
    it('starts clean with the student values', () => {
      const { result } = renderHook(() => useStudentForm(student))
      expect(result.current.values.name).toBe('Ali Hassan')
      expect(result.current.isDirty).toBe(false)
      expect(result.current.getPayload()).toEqual({})
    })

    it('submits only the changed fields', () => {
      const { result } = renderHook(() => useStudentForm(student))
      act(() => {
        result.current.setField('blood_group', 'O+')
        result.current.setField('name', 'Ali H.')
      })
      expect(result.current.isDirty).toBe(true)
      expect(result.current.getPayload()).toEqual({ name: 'Ali H.', blood_group: 'O+' })
    })

    it('becomes clean again when a change is typed back', () => {
      const { result } = renderHook(() => useStudentForm(student))
      act(() => result.current.setField('name', 'X'))
      act(() => result.current.setField('name', 'Ali Hassan'))
      expect(result.current.isDirty).toBe(false)
    })

    it('does not flag untouched legacy values as invalid', () => {
      const legacy = { ...student, guardian_email: 'broken' }
      const { result } = renderHook(() => useStudentForm(legacy))
      act(() => result.current.setField('name', 'Renamed'))
      let ok
      act(() => { ok = result.current.validate() })
      expect(ok).toBe(true)
    })
  })

  describe('create mode', () => {
    it('submits the full normalized payload', () => {
      const { result } = renderHook(() => useStudentForm(null))
      act(() => {
        result.current.setField('name', ' Sara ')
        result.current.setField('roll_number', '5')
        result.current.setField('parent_phone', '0300-2222222')
      })
      const payload = result.current.getPayload()
      expect(payload).toMatchObject({ name: 'Sara', roll_number: '5', parent_phone: '+923002222222', date_of_birth: null })
      expect(Object.keys(payload).length).toBeGreaterThan(10)
    })

    it('fails validation with field errors, and clears one when the field is edited', () => {
      const { result } = renderHook(() => useStudentForm(null))
      let ok
      act(() => { ok = result.current.validate() })
      expect(ok).toBe(false)
      expect(Object.keys(result.current.errors).sort()).toEqual(['name', 'roll_number'])

      act(() => result.current.setField('name', 'Sara'))
      expect(Object.keys(result.current.errors)).toEqual(['roll_number'])
    })
  })

  describe('applyServerError', () => {
    it('puts field errors on their fields', () => {
      const { result } = renderHook(() => useStudentForm(student))
      act(() => {
        result.current.applyServerError(drfError({ roll_number: ["Roll number '4' already exists."] }))
      })
      expect(result.current.errors).toEqual({ roll_number: "Roll number '4' already exists." })
      expect(result.current.formError).toBeNull()
    })

    it('keeps errors for fields the form has no input for in the form-level message', () => {
      const { result } = renderHook(() => useStudentForm(student))
      act(() => {
        result.current.applyServerError(drfError({
          class_obj: ['Not in this school.'],
          non_field_errors: ['Bad request'],
        }))
      })
      expect(result.current.errors).toEqual({})
      expect(result.current.formError).toBe('Bad request, class_obj: Not in this school.')
    })

    it('shows a network failure as a form-level error', () => {
      const { result } = renderHook(() => useStudentForm(student))
      act(() => {
        result.current.applyServerError({ message: 'Network Error' })
      })
      expect(result.current.formError).toMatch(/network error/i)
    })

    it('returns the leaving conflict to the caller without touching form errors', () => {
      const { result } = renderHook(() => useStudentForm(student))
      const body = { code: 'records_after_leaving', detail: 'x' }
      let parsed
      act(() => { parsed = result.current.applyServerError(drfError(body)) })
      expect(parsed.conflict).toEqual(body)
      expect(result.current.errors).toEqual({})
      expect(result.current.formError).toBeNull()
    })
  })

  it('setFieldError puts a message on one field without touching the others', () => {
    const { result } = renderHook(() => useStudentForm(student))
    act(() => result.current.applyServerError(drfError({ name: ['Bad'] })))
    act(() => result.current.setFieldError('roll_number', 'Taken. Suggested next roll: 5.'))
    expect(result.current.errors).toEqual({ name: 'Bad', roll_number: 'Taken. Suggested next roll: 5.' })
  })

  it('reset restores the student values and clears errors', () => {
    const { result } = renderHook(() => useStudentForm(student))
    act(() => {
      result.current.setField('name', 'Changed')
      result.current.applyServerError(drfError({ name: ['Bad'] }))
    })
    act(() => result.current.reset(student))
    expect(result.current.values.name).toBe('Ali Hassan')
    expect(result.current.errors).toEqual({})
    expect(result.current.isDirty).toBe(false)
  })
})
