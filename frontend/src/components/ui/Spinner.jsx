/**
 * Shared loading spinner. Standardizes on border-primary-600 (the theme color) —
 * several pages had drifted to border-blue-600, a visually different stock Tailwind blue.
 *
 * Usage:
 *   <Spinner />                    // inline, size="md" (h-8 w-8) — most common in-page loading state
 *   <Spinner size="sm" />          // h-6 w-6 — inline with text
 *   <Spinner size="lg" />          // h-12 w-12
 *   <Spinner fullScreen size="lg" /> // full-viewport centered, used by LoadingSpinner.jsx
 *   <Spinner size="xs" light />    // h-4 w-4, white border — for use inside a solid-color Button
 */

const SIZES = {
  xs: 'h-4 w-4',
  sm: 'h-6 w-6',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
}

export default function Spinner({ size = 'md', fullScreen = false, light = false, className = '' }) {
  const dims = SIZES[size] || SIZES.md
  const borderColor = light ? 'border-white' : 'border-primary-600'
  const spinner = (
    <div className={`animate-spin rounded-full ${dims} border-b-2 ${borderColor} ${className}`} />
  )

  if (!fullScreen) return spinner

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      {spinner}
    </div>
  )
}
