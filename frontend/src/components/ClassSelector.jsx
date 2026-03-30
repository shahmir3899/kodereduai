import { useClasses } from '../hooks/useClasses'
import { useSessionClasses } from '../hooks/useSessionClasses'

const classOptionCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

function normalizeText(value) {
  return String(value || '').trim()
}

function getComparableName(option) {
  return normalizeText(option.name || option.display_name || option.label)
}

function getComparableSection(option) {
  return normalizeText(option.section)
}

function getComparableGrade(option) {
  const numericGrade = Number(option.grade_level)
  return Number.isFinite(numericGrade) ? numericGrade : Number.MAX_SAFE_INTEGER
}

function sortClassOptions(options = []) {
  return [...options].sort((left, right) => {
    const gradeDiff = getComparableGrade(left) - getComparableGrade(right)
    if (gradeDiff !== 0) return gradeDiff

    const nameDiff = classOptionCollator.compare(getComparableName(left), getComparableName(right))
    if (nameDiff !== 0) return nameDiff

    const sectionDiff = classOptionCollator.compare(getComparableSection(left), getComparableSection(right))
    if (sectionDiff !== 0) return sectionDiff

    return classOptionCollator.compare(normalizeText(left.label), normalizeText(right.label))
  })
}

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

  const sortedClasses = sortClassOptions(resolvedClasses)

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
      {sortedClasses.map((cls) => (
        <option key={cls.id} value={cls.id}>
          {cls.label || `${cls.name}${cls.section ? ` - ${cls.section}` : ''}`}
        </option>
      ))}
    </select>
  )
}
