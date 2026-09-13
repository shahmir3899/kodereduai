/**
 * Shared status pill. Standardizes the 150+ hand-rolled
 * `rounded-full ... text-xs font-medium` status chips found across pages,
 * and retires the yellow/amber split — "warning" is always amber here.
 *
 * Usage:
 *   <Badge tone="success">Active</Badge>
 *   <Badge tone="warning">Pending</Badge>
 *   <Badge tone="danger">Overdue</Badge>
 *   <Badge tone="info">Draft</Badge>
 *   <Badge tone="neutral">Archived</Badge>
 */

const TONES = {
  success: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  danger: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  info: 'bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-300',
  neutral: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
}

export default function Badge({ tone = 'neutral', children, className = '', ...props }) {
  const toneClasses = TONES[tone] || TONES.neutral
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${toneClasses} ${className}`} {...props}>
      {children}
    </span>
  )
}
