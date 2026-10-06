import { forwardRef } from 'react'
import SearchableSelect from '../SearchableSelect'

/**
 * Two forms, one look:
 *
 *  1. Native (default) — drop-in for <select>, children are <option>s, onChange gets the event:
 *       <Select value={cls} onChange={(e) => setCls(e.target.value)}>
 *         <option value="">All classes</option>…
 *       </Select>
 *
 *  2. Options form — pass `options={[{ value, label }]}` and `onValueChange(value)`.
 *     Lists longer than `searchableAbove` (default 15) automatically become a
 *     typeahead (SearchableSelect) — classes/months stay native, student and staff
 *     pickers get search. Force with `searchable` / `searchable={false}`.
 *       <Select options={students} value={id} onValueChange={setId} placeholder="Select student" />
 */
const Select = forwardRef(function Select(
  { options, onValueChange, searchable, searchableAbove = 15, placeholder, error = false, className = '', children, value, disabled, required, ...props },
  ref,
) {
  if (options) {
    const useSearch = searchable ?? options.length > searchableAbove
    if (useSearch) {
      return (
        <SearchableSelect
          options={options}
          value={value}
          onChange={onValueChange}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          className={className}
        />
      )
    }
    return (
      <select
        ref={ref}
        value={value ?? ''}
        disabled={disabled}
        required={required}
        onChange={(e) => onValueChange?.(e.target.value)}
        className={`input ${error ? 'input-error' : ''} ${className}`.trim()}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    )
  }
  return (
    <select ref={ref} value={value} disabled={disabled} required={required} className={`input ${error ? 'input-error' : ''} ${className}`.trim()} {...props}>
      {children}
    </select>
  )
})

export default Select
