import Spinner from './Spinner'

/**
 * Shared action button. Standardizes on bg-primary-600 (the theme color) —
 * many pages had drifted to stock Tailwind bg-blue-600, a visually different blue.
 *
 * Usage:
 *   <Button onClick={...}>Save</Button>                       // variant="primary" (default)
 *   <Button variant="secondary" onClick={...}>Cancel</Button>
 *   <Button variant="danger" onClick={...}>Delete</Button>
 *   <Button variant="ghost" onClick={...}>Skip</Button>
 *   <Button loading disabled>Saving...</Button>                // shows inline Spinner, auto-disables
 *   <Button size="sm">Small</Button>
 */

const VARIANTS = {
  primary: 'bg-primary-600 hover:bg-primary-700 text-white border border-transparent',
  secondary: 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-200 dark:border-gray-600',
  danger: 'bg-red-600 hover:bg-red-700 text-white border border-transparent',
  ghost: 'bg-transparent hover:bg-gray-100 text-gray-700 border border-transparent dark:hover:bg-gray-700 dark:text-gray-200',
}

const SIZES = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  className = '',
  children,
  ...props
}) {
  const variantClasses = VARIANTS[variant] || VARIANTS.primary
  const sizeClasses = SIZES[size] || SIZES.md

  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${variantClasses} ${sizeClasses} ${className}`}
      {...props}
    >
      {loading && <Spinner size="xs" light={variant === 'primary' || variant === 'danger'} />}
      {children}
    </button>
  )
}
