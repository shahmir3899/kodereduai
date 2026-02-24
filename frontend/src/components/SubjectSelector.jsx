import { useSubjects } from '../hooks/useSubjects'

export default function SubjectSelector({
  value,
  onChange,
  placeholder = 'Select subject...',
  showAllOption = false,
  allOptionLabel = 'All Subjects',
  className = 'input',
  disabled = false,
  required = false,
  name,
  id,
  subjects: externalSubjects,
  schoolId,
}) {
  const { subjects: fetchedSubjects, isLoading } = useSubjects(externalSubjects ? null : schoolId)
  const subjects = externalSubjects || fetchedSubjects

  return (
    <select
      value={value}
      onChange={onChange}
      className={className}
      disabled={disabled || (!externalSubjects && isLoading)}
      required={required}
      name={name}
      id={id}
    >
      <option value="">
        {!externalSubjects && isLoading ? 'Loading subjects...' : (showAllOption ? allOptionLabel : placeholder)}
      </option>
      {subjects.map((sub) => (
        <option key={sub.id} value={sub.id}>
          {sub.name}
        </option>
      ))}
    </select>
  )
}
