import { forwardRef } from 'react'

/** Multi-line input on the shared `.input` style. See Input. */
const Textarea = forwardRef(function Textarea({ error = false, rows = 3, className = '', ...props }, ref) {
  return <textarea ref={ref} rows={rows} className={`input ${error ? 'input-error' : ''} ${className}`.trim()} {...props} />
})

export default Textarea
