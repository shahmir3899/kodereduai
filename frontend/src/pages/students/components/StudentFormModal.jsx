import { useCallback, useEffect, useMemo, useState } from 'react'
import ClassSelector from '../../../components/ClassSelector'
import { PasswordInput } from '../../../components'
import { usePasswordPolicy } from '../../../hooks/usePasswordPolicy'
import { useEscapeKey } from '../../../hooks/useEscapeKey'
import { useRollSuggestion } from '../../../hooks/useRollSuggestion'
import { useStudentForm } from '../../../hooks/useStudentForm'
import { STUDENT_FIELDS } from '../studentFieldConfig'
import StudentForm from './StudentForm'

const QUICK_FIELDS = new Set(STUDENT_FIELDS.filter((f) => f.quick).map((f) => f.name))
const suggestUsername = (name) => name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
const EMPTY_ACCOUNT = { username: '', email: '', password: '', confirm_password: '' }

// Add / edit a student from the list page. Mount only while open.
//
// Create shows the quick fields (name, roll, parent) with the rest behind
// "Show more fields", and can create a portal login in the same step. Edit shows
// everything, sends only what changed, and shows the class read-only: moving a
// student between classes goes through reclassify, not this form. When onChangeClass
// is given (admins) the class line gets a "Change class" button that hands off to it.
//
// onSubmit({ payload, classId, account }) must resolve on success (the page then
// unmounts this modal) and reject with the API error otherwise; the error is
// shown on the form, not as a toast.
export default function StudentFormModal({
  student = null,
  allStudents,
  classSelector,
  resolveMasterClassId,
  initialClassId = '',
  photoSlot = null,
  onChangeClass = null,
  onSubmit,
  onClose,
}) {
  const isEdit = !!student
  const form = useStudentForm(student)
  const { validate: validatePassword } = usePasswordPolicy()

  const [classId, setClassId] = useState(initialClassId)
  const [classError, setClassError] = useState('')
  const [rollTyped, setRollTyped] = useState(isEdit)
  const [expanded, setExpanded] = useState(isEdit)
  const [wantsAccount, setWantsAccount] = useState(false)
  const [account, setAccount] = useState(EMPTY_ACCOUNT)
  const [accountError, setAccountError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)

  const resolvedClassId = isEdit ? String(student.class_obj ?? '') : resolveMasterClassId(classId)

  const occupiedRolls = useMemo(
    () => (resolvedClassId
      ? allStudents
        .filter((s) => String(s.class_obj) === resolvedClassId && s.id !== student?.id)
        .map((s) => s.roll_number)
      : []),
    [allStudents, resolvedClassId, student?.id],
  )

  const autoFillRoll = useCallback((roll) => form.setField('roll_number', roll), [form.setField])
  const { recommendedRoll } = useRollSuggestion({
    enabled: true,
    hasClass: !!resolvedClassId,
    occupiedRolls,
    currentRoll: form.values.roll_number,
    manuallyEdited: rollTyped,
    onAutoFill: autoFillRoll,
  })

  // An error on a field hidden by the compact create form would otherwise be invisible.
  useEffect(() => {
    if (Object.keys(form.errors).some((name) => !QUICK_FIELDS.has(name))) setExpanded(true)
  }, [form.errors])

  // Auto-filled roll numbers do not count as edits, or choosing a class alone would make the form dirty.
  const hasEdits = isEdit
    ? form.isDirty
    : rollTyped || wantsAccount || Object.entries(form.values).some(([name, value]) => name !== 'roll_number' && value)

  const requestClose = () => {
    if (saving) return
    if (confirmingDiscard) {
      setConfirmingDiscard(false)
      return
    }
    if (hasEdits) setConfirmingDiscard(true)
    else onClose()
  }
  useEscapeKey(requestClose, true)

  const handleFieldChange = (name, value) => {
    form.setField(name, value)
    if (name === 'name' && wantsAccount) setAccount((a) => ({ ...a, username: suggestUsername(value) }))
  }

  const handleClassChange = (value) => {
    setClassId(value)
    setClassError('')
    if (!form.values.roll_number.trim()) setRollTyped(false)
  }

  const toggleAccount = (checked) => {
    setWantsAccount(checked)
    if (checked && form.values.name) setAccount((a) => ({ ...a, username: suggestUsername(form.values.name) }))
  }

  const handleSubmit = async () => {
    setAccountError('')
    const fieldsValid = form.validate()
    const classValid = isEdit || !!resolvedClassId
    setClassError(classValid ? '' : 'Please select a class')

    let accountValid = true
    if (wantsAccount && !isEdit) {
      const problem = (!account.username || !account.password)
        ? 'Username and password are required for user account.'
        : validatePassword(account.password, account.confirm_password)
      if (problem) {
        setAccountError(problem)
        accountValid = false
      }
    }
    if (!fieldsValid || !classValid || !accountValid) return

    const payload = form.getPayload()
    if (isEdit && Object.keys(payload).length === 0) {
      onClose()
      return
    }

    setSaving(true)
    try {
      await onSubmit({ payload, classId: resolvedClassId, account: wantsAccount && !isEdit ? account : null })
    } catch (error) {
      const parsed = form.applyServerError(error, isEdit ? 'Failed to update student' : 'Failed to add student')
      if (parsed.fieldErrors.roll_number && recommendedRoll) {
        form.setFieldError('roll_number', `${parsed.fieldErrors.roll_number} Suggested next roll: ${recommendedRoll}.`)
      }
    } finally {
      setSaving(false)
    }
  }

  const classSlot = isEdit ? (
    <div>
      <span className="label">Class</span>
      <div className="flex items-center gap-3">
        <p className="text-sm text-gray-900">{student.class_name || '—'}</p>
        {onChangeClass && (
          <button
            type="button"
            onClick={onChangeClass}
            disabled={hasEdits || saving}
            title={hasEdits ? 'Save or discard your edits first' : undefined}
            className="text-sm font-medium text-blue-600 hover:text-blue-700 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            Change class
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500 mt-1">
        {onChangeClass
          ? 'Changing class closes this form and is recorded with a reason. Save or discard your edits first.'
          : 'Class cannot be changed here.'}
      </p>
    </div>
  ) : (
    <div>
      <label className="label" htmlFor="student-form-class">Class *</label>
      <ClassSelector
        id="student-form-class"
        className="input"
        value={classId}
        onChange={(e) => handleClassChange(e.target.value)}
        required
        placeholder="Select a class"
        scope={classSelector.scope}
        academicYearId={classSelector.academicYearId}
        schoolId={classSelector.schoolId}
      />
      {classError && <p role="alert" className="text-xs text-red-600 mt-1">{classError}</p>}
    </div>
  )

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[92vh] flex flex-col">
        <div className="p-4 sm:p-6 overflow-y-auto">
          <h2 className="text-xl font-bold text-gray-900 mb-4">{isEdit ? 'Edit Student' : 'Add Student'}</h2>

          {photoSlot && <div className="mb-4">{photoSlot}</div>}

          {form.formError && (
            <p role="alert" className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {form.formError}
            </p>
          )}

          <StudentForm
            values={form.values}
            errors={form.errors}
            onChange={handleFieldChange}
            classSlot={classSlot}
            fieldFilter={expanded ? undefined : (f) => f.quick}
            rollSuggestion={recommendedRoll}
            onApplyRollSuggestion={() => {
              form.setField('roll_number', recommendedRoll)
              setRollTyped(true)
            }}
            onRollTyped={() => setRollTyped(true)}
            disabled={saving}
            showSectionHeadings={expanded}
          />

          {!isEdit && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-4 text-sm font-medium text-primary-600 hover:text-primary-700"
            >
              {expanded ? 'Show fewer fields' : 'Show more fields'}
            </button>
          )}

          {!isEdit && (
            <div className="border-t border-gray-200 pt-4 mt-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={wantsAccount}
                  onChange={(e) => toggleAccount(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm font-medium text-gray-700">Create User Account (Student Portal)</span>
              </label>
              <p className="text-xs text-gray-500 mt-1 ml-6">Create login credentials so the student can access the Student Portal</p>

              {wantsAccount && (
                <div className="mt-3 ml-6 space-y-3 p-3 bg-gray-50 rounded-lg">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Username *</label>
                    <input
                      type="text"
                      className="input text-sm"
                      value={account.username}
                      onChange={(e) => setAccount((a) => ({ ...a, username: e.target.value }))}
                      placeholder="Login username"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
                    <input
                      type="email"
                      className="input text-sm"
                      value={account.email}
                      onChange={(e) => setAccount((a) => ({ ...a, email: e.target.value }))}
                      placeholder="Email address (optional)"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Password *</label>
                      <PasswordInput
                        className="input text-sm"
                        value={account.password}
                        onChange={(e) => setAccount((a) => ({ ...a, password: e.target.value }))}
                        placeholder="Min 8 chars"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Confirm *</label>
                      <PasswordInput
                        className="input text-sm"
                        value={account.confirm_password}
                        onChange={(e) => setAccount((a) => ({ ...a, confirm_password: e.target.value }))}
                        placeholder="Confirm"
                      />
                    </div>
                  </div>
                  {accountError && <p className="text-xs text-red-600">{accountError}</p>}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 px-4 sm:px-6 py-4">
          {confirmingDiscard ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-gray-700">Discard your unsaved changes?</p>
              <div className="flex space-x-3">
                <button type="button" onClick={() => setConfirmingDiscard(false)} className="btn btn-secondary">
                  Keep editing
                </button>
                <button type="button" onClick={onClose} className="btn btn-danger">
                  Discard
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end space-x-3">
              <button type="button" onClick={requestClose} disabled={saving} className="btn btn-secondary">
                Cancel
              </button>
              <button type="button" onClick={handleSubmit} disabled={saving} className="btn btn-primary">
                {saving ? 'Saving...' : (isEdit ? 'Save Changes' : 'Add Student')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
