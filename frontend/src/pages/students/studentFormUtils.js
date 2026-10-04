import { getErrorMessage } from '../../utils/errorUtils'
import { STUDENT_FIELDS, STUDENT_FIELD_NAMES } from './studentFieldConfig'

export function normalizeGender(gender) {
  if (!gender) return ''
  const value = String(gender).trim().toUpperCase()
  if (value === 'MALE') return 'M'
  if (value === 'FEMALE') return 'F'
  if (value === 'OTHER') return 'O'
  if (value === 'M' || value === 'F' || value === 'O') return value
  return ''
}

// Normalizes a typed/pasted phone to +92XXXXXXXXXX where it can. Moved here
// from StudentsPage so the profile form can share it.
export function parsePhone(rawPhone) {
  if (!rawPhone) return ''

  let phone = String(rawPhone).trim()

  // Legacy Excel imports prefixed numbers with "P:" to keep them as text
  if (phone.toUpperCase().startsWith('P:')) {
    phone = phone.substring(2).trim()
  }

  // Excel turns long numbers into scientific notation; expand before stripping characters
  if (String(rawPhone).includes('E') || String(rawPhone).includes('e')) {
    const expanded = Number(rawPhone)
    if (Number.isFinite(expanded)) phone = expanded.toFixed(0)
  }

  phone = phone.replace(/[^\d+]/g, '')

  if (phone.startsWith('03')) {
    phone = '+92' + phone.substring(1)
  } else if (phone.startsWith('3') && phone.length === 10) {
    phone = '+92' + phone
  } else if (phone.startsWith('92') && !phone.startsWith('+')) {
    phone = '+' + phone
  } else if (phone.match(/^9[0-9]{11}$/)) {
    phone = '+' + phone
  }

  return phone
}

export function emptyStudentForm() {
  return Object.fromEntries(STUDENT_FIELD_NAMES.map((name) => [name, '']))
}

export function studentToForm(student) {
  const form = emptyStudentForm()
  if (!student) return form
  for (const name of STUDENT_FIELD_NAMES) {
    form[name] = student[name] ?? ''
  }
  form.gender = normalizeGender(student.gender)
  return form
}

// Only parent_phone is normalized: the list page always did, the profile page
// never did, and silently reformatting guardian/emergency numbers on save
// would be a behaviour change nobody asked for.
export function formToPayload(values) {
  const payload = {}
  for (const field of STUDENT_FIELDS) {
    const raw = values[field.name] ?? ''
    if (field.kind === 'date') {
      payload[field.name] = raw || null
    } else if (field.kind === 'gender') {
      payload[field.name] = normalizeGender(raw)
    } else if (field.kind === 'phone') {
      payload[field.name] = raw ? parsePhone(raw) : ''
    } else {
      payload[field.name] = typeof raw === 'string' ? raw.trim() : raw
    }
  }
  return payload
}

// PATCH body for an edit: just the fields whose normalized value differs from
// what the student already has. Comparing normalized values means an untouched
// legacy phone like "0300-1111111" is not re-sent as "+923001111111".
export function getChangedPayload(student, values) {
  const before = formToPayload(studentToForm(student))
  const after = formToPayload(values)
  const changed = {}
  for (const name of STUDENT_FIELD_NAMES) {
    if (before[name] !== after[name]) changed[name] = after[name]
  }
  return changed
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\+?\d{7,15}$/

// Required fields are always checked. Format checks run only on fields the user
// changed (when `initial` is given), so legacy values that predate a rule never
// block an unrelated edit. The server stays the authority on everything.
export function validateStudentForm(values, { initial = null, today = new Date() } = {}) {
  const errors = {}
  const before = initial ? formToPayload(studentToForm(initial)) : null
  const after = formToPayload(values)
  const touched = (name) => !before || before[name] !== after[name]

  for (const field of STUDENT_FIELDS) {
    const value = after[field.name]
    if (field.required && !value) {
      errors[field.name] = `${field.label} is required`
      continue
    }
    if (!touched(field.name) || value === '' || value == null) continue

    if (field.maxLength && String(value).length > field.maxLength) {
      errors[field.name] = `${field.label} must be at most ${field.maxLength} characters`
    } else if (field.phone && !PHONE_RE.test(value)) {
      errors[field.name] = 'Enter a valid phone number'
    } else if (field.type === 'email' && !EMAIL_RE.test(value)) {
      errors[field.name] = 'Enter a valid email address'
    } else if (field.name === 'date_of_birth' && new Date(value) > today) {
      errors[field.name] = 'Date of birth cannot be in the future'
    }
  }
  return errors
}

const NON_FIELD_KEYS = new Set(['non_field_errors', 'detail', 'code'])

const firstMessage = (value) => {
  if (Array.isArray(value)) return value.map(String).join(', ')
  if (value && typeof value === 'object') return Object.values(value).map(String).join(', ')
  return String(value)
}

// Splits a DRF error response into per-field messages and a form-level one.
// The leaving-conflict body (code: records_after_leaving) belongs to the status
// dialog, which renders its own summary, so it is passed through untouched.
export function parseDrfErrors(error, fallback = 'Something went wrong') {
  const data = error?.response?.data
  if (data?.code === 'records_after_leaving') {
    return { fieldErrors: {}, formError: null, conflict: data }
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { fieldErrors: {}, formError: getErrorMessage(error, fallback), conflict: null }
  }

  const fieldErrors = {}
  const formMessages = []
  for (const [key, value] of Object.entries(data)) {
    if (key === 'code') continue
    if (NON_FIELD_KEYS.has(key)) formMessages.push(firstMessage(value))
    else fieldErrors[key] = firstMessage(value)
  }

  return {
    fieldErrors,
    formError: formMessages.length ? formMessages.join(', ') : null,
    conflict: null,
  }
}
