import { useClasses } from '../hooks/useClasses'

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
}) {
  const { classes: fetchedClasses, isLoading } = useClasses(externalClasses ? null : schoolId)
  const classes = externalClasses || fetchedClasses

  return (
    <select
      value={value}
      onChange={onChange}
      className={className}
      disabled={disabled || (!externalClasses && isLoading)}
      required={required}
      name={name}
      id={id}
    >
      <option value="">
        {!externalClasses && isLoading ? 'Loading classes...' : (showAllOption ? allOptionLabel : placeholder)}
      </option>
      {classes.map((cls) => (
        <option key={cls.id} value={cls.id}>
          {cls.name}{cls.section ? ` - ${cls.section}` : ''}
        </option>
      ))}
    </select>
  )
}
