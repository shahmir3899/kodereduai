import { cloneElement, isValidElement, useId } from 'react'

/**
 * Label + control + hint/error, so every form shows validation the same way.
 * Wraps a single <input>/<select>/<textarea> (or the ui Input/Select/Textarea):
 * it wires the label's htmlFor, aria-describedby and aria-invalid for you.
 *
 * Usage:
 *   <Field label="Roll number" required error={errors.roll}>
 *     <input className="input" value={roll} onChange={...} />
 *   </Field>
 *   <Field label="Phone" hint="Used for SMS alerts">
 *     <Input value={phone} onChange={...} />
 *   </Field>
 *
 * `className` goes on the wrapper (grid spans like sm:col-span-2 etc.).
 */
export default function Field({ label, hint, error, required = false, htmlFor, className = '', children }) {
  const autoId = useId()
  const child = isValidElement(children) ? children : null
  const id = htmlFor || child?.props?.id || autoId
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined

  const control = child
    ? cloneElement(child, {
        id,
        'aria-describedby': child.props['aria-describedby'] || describedBy,
        'aria-invalid': child.props['aria-invalid'] ?? (error ? true : undefined),
        error: typeof child.type === 'string' ? undefined : child.props.error ?? !!error,
      })
    : children

  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="label">
          {label}
          {required && <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>}
        </label>
      )}
      {control}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
      ) : null}
    </div>
  )
}
