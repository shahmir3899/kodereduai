/**
 * Status pill used inside RecordCard (and standalone) — one place that owns the
 * tone→color mapping so every page's card/table badges agree with each other.
 * Existing pages each hand-roll this mapping (see StaffDirectoryPage's statusBadge
 * object); new/migrated pages should map their status value to a `tone` here
 * instead of picking Tailwind classes per page.
 */
const TONE_CLASSES = {
  success: 'bg-green-100 text-green-800',
  warning: 'bg-yellow-100 text-yellow-800',
  danger: 'bg-red-100 text-red-800',
  neutral: 'bg-gray-100 text-gray-800',
  info: 'bg-blue-100 text-blue-800',
}

export default function StatusPill({ label, tone = 'neutral', className = '' }) {
  if (!label) return null
  const toneClass = TONE_CLASSES[tone] || TONE_CLASSES.neutral
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${toneClass} ${className}`}>
      {label}
    </span>
  )
}
