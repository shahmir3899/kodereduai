import { forwardRef } from 'react'

/**
 * Text input on the shared `.input` style (index.css): same height, focus ring,
 * and the mobile 16px font that stops iOS zooming on focus. Pass `error` for the
 * red invalid state (Field does this for you).
 */
const Input = forwardRef(function Input({ error = false, className = '', ...props }, ref) {
  return <input ref={ref} className={`input ${error ? 'input-error' : ''} ${className}`.trim()} {...props} />
})

export default Input
