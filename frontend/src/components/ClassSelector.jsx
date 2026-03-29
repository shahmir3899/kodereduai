import { useClasses } from '../hooks/useClasses'
import { useSessionClasses } from '../hooks/useSessionClasses'

export default function ClassSelector({
  value,
  onChange,
  placeholder = 'Select class...',
  showAllOption = false,
  allOptionLabel = 'All Classes',
  className = 'input',
  disabled = false,
  required = false,
  name,
  id,
  classes: externalClasses,
  schoolId,
  scope = 'master',
  academicYearId,
}) {
  const { classes: fetchedMasterClasses, isLoading: masterLoading } = useClasses(externalClasses ? null : schoolId)
  const { sessionClasses, isLoading: sessionLoading } = useSessionClasses(
    externalClasses ? null : academicYearId,
    externalClasses ? null : schoolId,
  )

  const resolvedClasses = externalClasses || (
    scope === 'session'
      ? sessionClasses
        .filter(sc => !!sc.class_obj)
        .map(sc => ({
          id: sc.id,
          class_obj: sc.class_obj,
          name: sc.display_name,
          section: sc.section || '',
          grade_level: sc.grade_level,
          label: sc.label,
        }))
      : fetchedMasterClasses
  )

  const isLoading = externalClasses ? false : (scope === 'session' ? sessionLoading : masterLoading)

  return (
    <select
      value={value}
      onChange={onChange}
      className={className}
      disabled={disabled || isLoading}
      required={required}
      name={name}
      id={id}
    >
      <option value="">
        {!externalClasses && isLoading ? 'Loading classes...' : (showAllOption ? allOptionLabel : placeholder)}
      </option>
      {resolvedClasses.map((cls) => (
        <option key={cls.id} value={cls.id}>
          {cls.label || `${cls.name}${cls.section ? ` - ${cls.section}` : ''}`}
        </option>
      ))}
    </select>
  )
}
