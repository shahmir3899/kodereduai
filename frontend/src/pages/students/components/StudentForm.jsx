import { useEffect, useId } from 'react'
import WhatsAppTick from '../../../components/WhatsAppTick'
import { STUDENT_FIELDS, STUDENT_SECTIONS, fieldsInSection } from '../studentFieldConfig'

// Renders the student fields from studentFieldConfig; owns no state. Pair with
// useStudentForm. The class control differs between pages (a selector when
// creating, a read-only line when editing), so the page passes it as classSlot.
export default function StudentForm({
  values,
  errors = {},
  onChange,
  sections,
  classSlot = null,
  rollSuggestion = '',
  onApplyRollSuggestion,
  onRollTyped,
  disabled = false,
  showSectionHeadings,
  fieldFilter,
}) {
  const uid = useId()
  const visibleFields = (sectionKey) => fieldsInSection(sectionKey).filter((f) => !fieldFilter || fieldFilter(f))
  // A section whose fields are all filtered out disappears, heading included.
  const shown = STUDENT_SECTIONS.filter(
    (s) => (!sections || sections.includes(s.key)) && (s.key === 'basic' && classSlot ? true : visibleFields(s.key).length > 0),
  )
  const headings = showSectionHeadings ?? shown.length > 1
  const idFor = (name) => `${uid}-${name}`

  // Land on the first invalid field, in form order, when a save is rejected.
  useEffect(() => {
    const first = STUDENT_FIELDS.find((f) => errors[f.name])
    if (first) document.getElementById(idFor(first.name))?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errors])

  const handleChange = (field) => (e) => {
    if (field.name === 'roll_number') onRollTyped?.()
    onChange(field.name, e.target.value)
  }

  const renderControl = (field) => {
    const error = errors[field.name]
    const common = {
      id: idFor(field.name),
      value: values[field.name] ?? '',
      onChange: handleChange(field),
      disabled,
      required: field.required,
      maxLength: field.maxLength,
      placeholder: field.placeholder,
      className: `input${error ? ' border-red-500' : ''}`,
      'aria-invalid': error ? true : undefined,
      'aria-describedby': error ? `${idFor(field.name)}-error` : undefined,
    }
    if (field.type === 'select') {
      return (
        <select {...common}>
          <option value="">Select…</option>
          {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    }
    if (field.type === 'textarea') return <textarea rows={2} {...common} />
    return <input type={field.type} {...common} />
  }

  return (
    <div className="space-y-6">
      {shown.map((section) => (
        <fieldset key={section.key} className="space-y-4">
          {headings
            ? <legend className="text-sm font-semibold text-gray-700 mb-2">{section.label}</legend>
            : null}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {section.key === 'basic' && classSlot ? (
              <div className="sm:col-span-2">{classSlot}</div>
            ) : null}
            {visibleFields(section.key).map((field) => {
              const error = errors[field.name]
              const wide = field.type === 'textarea' || field.name === 'name'
              return (
                <div key={field.name} className={wide ? 'sm:col-span-2' : undefined}>
                  <div className="flex items-center justify-between">
                    <label htmlFor={idFor(field.name)} className="label">
                      {field.label}{field.required ? ' *' : ''}
                    </label>
                    {field.name === 'roll_number' && rollSuggestion ? (
                      <button
                        type="button"
                        onClick={onApplyRollSuggestion}
                        disabled={disabled}
                        className="text-xs font-medium text-primary-600 hover:text-primary-700"
                      >
                        Suggest {rollSuggestion}
                      </button>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    {renderControl(field)}
                    {field.name === 'parent_phone' ? <WhatsAppTick phone={values.parent_phone} /> : null}
                  </div>
                  {error ? (
                    <p id={`${idFor(field.name)}-error`} role="alert" className="text-xs text-red-600 mt-1">
                      {error}
                    </p>
                  ) : field.name === 'roll_number' && rollSuggestion ? (
                    <p className="text-xs text-gray-500 mt-1">Next available roll in this class: {rollSuggestion}</p>
                  ) : field.hint ? (
                    <p className="text-xs text-gray-500 mt-1">{field.hint}</p>
                  ) : null}
                </div>
              )
            })}
          </div>
        </fieldset>
      ))}
    </div>
  )
}
