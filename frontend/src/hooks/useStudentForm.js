import { useCallback, useMemo, useState } from 'react'
import { STUDENT_FIELD_NAMES } from '../pages/students/studentFieldConfig'
import {
  formToPayload,
  getChangedPayload,
  parseDrfErrors,
  studentToForm,
  validateStudentForm,
} from '../pages/students/studentFormUtils'

// Form state for creating (student = null) or editing a student. Replaces the
// hand-rolled studentForm / editForm pairs and their duplicated default objects.
//
// Edit mode submits only what changed; create mode submits everything.
export function useStudentForm(student = null) {
  const [values, setValues] = useState(() => studentToForm(student))
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)

  const setField = useCallback((name, value) => {
    setValues((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => {
      if (!(name in prev)) return prev
      const { [name]: _cleared, ...rest } = prev
      return rest
    })
  }, [])

  const setFieldError = useCallback((name, message) => {
    setErrors((prev) => ({ ...prev, [name]: message }))
  }, [])

  // Pass the student again when re-opening an edit, or nothing to blank a create form.
  const reset = useCallback((nextStudent = null) => {
    setValues(studentToForm(nextStudent))
    setErrors({})
    setFormError(null)
  }, [])

  const isDirty = useMemo(
    () => Object.keys(getChangedPayload(student, values)).length > 0,
    [student, values],
  )

  // Returns true when the form may be submitted.
  const validate = useCallback(() => {
    const found = validateStudentForm(values, { initial: student })
    setErrors(found)
    setFormError(null)
    return Object.keys(found).length === 0
  }, [values, student])

  const getPayload = useCallback(
    () => (student ? getChangedPayload(student, values) : formToPayload(values)),
    [student, values],
  )

  // Routes a failed save onto the fields. Keys the form has no input for
  // (class_obj, status_date, ...) become part of the form-level message so
  // they are never silently dropped. The leaving conflict is returned for the
  // caller's status dialog.
  const applyServerError = useCallback((error, fallback = 'Failed to save student') => {
    const parsed = parseDrfErrors(error, fallback)
    if (parsed.conflict) return parsed

    const known = {}
    const stray = []
    for (const [key, message] of Object.entries(parsed.fieldErrors)) {
      if (STUDENT_FIELD_NAMES.includes(key)) known[key] = message
      else stray.push(`${key}: ${message}`)
    }
    setErrors(known)
    const messages = [parsed.formError, ...stray].filter(Boolean)
    setFormError(messages.length ? messages.join(', ') : null)
    return parsed
  }, [])

  return { values, errors, formError, setField, setFieldError, reset, isDirty, validate, getPayload, applyServerError }
}
