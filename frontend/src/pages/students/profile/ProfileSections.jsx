import { useCallback, useState } from 'react'
import Button from '../../../components/ui/Button'
import { useStudentForm } from '../../../hooks/useStudentForm'
import { useClassmateRolls } from '../../../hooks/useClassmateRolls'
import { useRollSuggestion } from '../../../hooks/useRollSuggestion'
import { fieldsInSection } from '../studentFieldConfig'
import StudentForm from '../components/StudentForm'
import { formatDate } from './profileUtils'

const GENDER_LABELS = { M: 'Male', F: 'Female', O: 'Other' }

function displayValue(field, student) {
  const raw = student[field.name]
  if (!raw) return null
  if (field.kind === 'date') return formatDate(raw)
  if (field.kind === 'gender') return GENDER_LABELS[raw] || raw
  return raw
}

// The student's details, one card per section. Each card reads normally and
// switches to an inline form on Edit, saving only that section's changes.
//
// onSave(payload) must resolve on success and reject with the API error, which
// the card shows beside the field. Class is never editable here; "Change class"
// opens the reclassify dialog instead.
export default function ProfileSections({ student, canEdit, canManageLifecycle, onSave, onChangeClass }) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      <SectionCard
        title="Basic"
        sectionKey="basic"
        student={student}
        canEdit={canEdit}
        onSave={onSave}
        extraRows={[{ label: 'Class', value: student.class_name }]}
        extraAction={canManageLifecycle ? { label: 'Change class', onClick: onChangeClass } : null}
      />
      <SectionCard title="Personal" sectionKey="personal" student={student} canEdit={canEdit} onSave={onSave} />
      <SectionCard title="Guardian" sectionKey="guardian" student={student} canEdit={canEdit} onSave={onSave} />
      <SectionCard
        title="Admission"
        sectionKey="admission"
        student={student}
        canEdit={canEdit}
        onSave={onSave}
        extraRows={[{ label: 'School', value: student.school_name }]}
      />
      <SystemCard student={student} />
    </div>
  )
}

function SectionCard({ title, sectionKey, student, canEdit, onSave, extraRows = [], extraAction = null }) {
  const [editing, setEditing] = useState(false)
  const rows = [
    ...fieldsInSection(sectionKey).map((f) => ({ label: f.label, value: displayValue(f, student), wide: f.type === 'textarea' })),
    ...extraRows,
  ]

  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden" aria-label={title}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {!editing && (
          <div className="flex items-center gap-3">
            {extraAction && (
              <button type="button" onClick={extraAction.onClick} className="text-sm font-medium text-blue-600 hover:text-blue-700">
                {extraAction.label}
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label={`Edit ${title}`}
                className="text-sm font-medium text-primary-600 hover:text-primary-700"
              >
                Edit
              </button>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <SectionEditor
          key={student.id}
          sectionKey={sectionKey}
          student={student}
          onSave={onSave}
          onDone={() => setEditing(false)}
        />
      ) : (
        <dl className="px-4 py-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
          {rows.map((row) => (
            <div key={row.label} className={row.wide ? 'md:col-span-2' : undefined}>
              <dt className="text-xs uppercase tracking-wide text-gray-500">{row.label}</dt>
              <dd className="text-sm text-gray-900 mt-0.5 break-words">
                {row.value || <span className="text-gray-400">Not set</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

function SectionEditor({ sectionKey, student, onSave, onDone }) {
  const form = useStudentForm(student)
  const [saving, setSaving] = useState(false)
  const [rollTyped, setRollTyped] = useState(true)

  // The roll number lives in the basic section; suggestions need the class roster.
  const isBasic = sectionKey === 'basic'
  const occupiedRolls = useClassmateRolls(student, isBasic)
  const autoFillRoll = useCallback((roll) => form.setField('roll_number', roll), [form.setField])
  const { recommendedRoll } = useRollSuggestion({
    enabled: isBasic,
    hasClass: !!student.class_obj,
    occupiedRolls,
    currentRoll: form.values.roll_number,
    manuallyEdited: rollTyped,
    onAutoFill: autoFillRoll,
  })

  const handleSave = async () => {
    if (!form.validate()) return
    const payload = form.getPayload()
    if (Object.keys(payload).length === 0) {
      onDone()
      return
    }
    setSaving(true)
    try {
      await onSave(payload)
      onDone()
    } catch (error) {
      const parsed = form.applyServerError(error, 'Failed to update student profile')
      if (parsed.fieldErrors.roll_number && recommendedRoll) {
        form.setFieldError('roll_number', `${parsed.fieldErrors.roll_number} Suggested next roll: ${recommendedRoll}.`)
      }
      setSaving(false)
    }
  }

  return (
    <div className="p-4 space-y-4">
      {form.formError && (
        <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {form.formError}
        </p>
      )}
      <StudentForm
        values={form.values}
        errors={form.errors}
        onChange={form.setField}
        sections={[sectionKey]}
        showSectionHeadings={false}
        classSlot={isBasic ? (
          <div>
            <span className="label">Class</span>
            <p className="text-sm text-gray-900">{student.class_name || '—'}</p>
          </div>
        ) : null}
        rollSuggestion={recommendedRoll}
        onApplyRollSuggestion={() => form.setField('roll_number', recommendedRoll)}
        disabled={saving}
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary"
 type="button"
 onClick={onDone}
 disabled={saving}>
          Cancel
        </Button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// Read-only: account and status details are changed through their own actions.
function SystemCard({ student }) {
  const [open, setOpen] = useState(false)
  const rows = [
    { label: 'Portal Account', value: student.has_user_account ? 'Enabled' : null },
    { label: 'Username', value: student.user_username },
    { label: 'Status Date', value: formatDate(student.status_date) },
    { label: 'Status Reason', value: student.status_reason },
  ].filter((row) => row.value)
  if (rows.length === 0) return null

  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden" aria-label="System">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-gray-900">System</span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <dl className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 border-t border-gray-100 pt-3">
          {rows.map((row) => (
            <div key={row.label}>
              <dt className="text-xs uppercase tracking-wide text-gray-500">{row.label}</dt>
              <dd className="text-sm text-gray-900 mt-0.5 break-words">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}
