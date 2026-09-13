import { Link } from 'react-router-dom'

/**
 * Shared card shell for list pages migrating off ad hoc "mobile card" blocks
 * (see StudentsPage/StaffDirectoryPage's old per-page markup). One shape reused
 * across modules — pages differ only in what they pass as fields/actions, not
 * in how the card is built. See docs/CARD_SYSTEM.md for the migration plan.
 *
 * fields: [{ label, value, mono? }] — rendered as a 2-column key/value grid.
 *   `value` may be any node (badges, WhatsApp ticks, etc.), not just text.
 * actions: [{ label, onClick?, to?, tone?, disabled? }] — rendered as text links/buttons,
 *   matching the existing table-row action convention (e.g. "View" primary,
 *   "Edit" info, "Delete" danger) rather than icon buttons, so migrated pages
 *   read the same as the table view they replace.
 * stripeTone: optional 'success'|'warning'|'danger'|'neutral' — left-edge accent
 *   for event/activity-style records (e.g. Lesson Plans) that don't use a leading avatar.
 * children: optional freeform content rendered below fields (before actions) —
 *   for records with content that doesn't fit the fixed slots above (a
 *   description, chip rows, nested badges) rather than forcing everything
 *   into the key/value grid.
 */
const STRIPE_CLASSES = {
  success: 'border-l-4 border-l-green-500',
  warning: 'border-l-4 border-l-yellow-500',
  danger: 'border-l-4 border-l-red-500',
  neutral: 'border-l-4 border-l-gray-300',
}

const ACTION_TONE_CLASSES = {
  primary: 'text-primary-600 hover:text-primary-800',
  info: 'text-blue-600 hover:text-blue-800',
  accent: 'text-purple-600 hover:text-purple-800',
  indigo: 'text-indigo-600 hover:text-indigo-800',
  orange: 'text-orange-600 hover:text-orange-800',
  amber: 'text-amber-600 hover:text-amber-800',
  teal: 'text-teal-600 hover:text-teal-800',
  danger: 'text-red-600 hover:text-red-800',
  success: 'text-green-600 hover:text-green-800',
  muted: 'text-gray-600 hover:text-gray-800',
}

function ActionItem({ action }) {
  const className = `text-xs font-medium ${ACTION_TONE_CLASSES[action.tone] || ACTION_TONE_CLASSES.primary} ${
    action.disabled ? 'opacity-50 pointer-events-none cursor-wait' : ''
  }`
  const stop = (e) => e.stopPropagation()
  if (action.to) {
    return (
      <Link to={action.to} className={className} onClick={stop}>
        {action.label}
      </Link>
    )
  }
  return (
    <button
      type="button"
      disabled={action.disabled}
      className={className}
      onClick={(e) => {
        stop(e)
        action.onClick?.(e)
      }}
    >
      {action.label}
    </button>
  )
}

export default function RecordCard({
  leading,
  title,
  meta,
  status,
  fields = [],
  actions = [],
  stripeTone,
  onClick,
  highlighted = false,
  children,
}) {
  const stripeClass = stripeTone ? STRIPE_CLASSES[stripeTone] || STRIPE_CLASSES.neutral : ''

  return (
    <div
      className={`bg-white border rounded-xl p-3 shadow-sm flex flex-col gap-2.5 ${
        highlighted ? 'border-primary-300 bg-primary-50/40' : 'border-gray-200'
      } ${stripeClass} ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start gap-2.5">
        {leading}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-gray-900 truncate">{title}</div>
          {meta && <div className="text-xs text-gray-500 mt-0.5 truncate">{meta}</div>}
        </div>
        {status}
      </div>

      {fields.length > 0 && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          {fields.map((f, i) => (
            <div key={i} className="min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-gray-400">{f.label}</div>
              <div className={`text-gray-800 truncate ${f.mono ? 'font-mono text-xs' : ''}`}>{f.value ?? '—'}</div>
            </div>
          ))}
        </div>
      )}

      {children}

      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
          {actions.map((a, i) => (
            <ActionItem key={i} action={a} />
          ))}
        </div>
      )}
    </div>
  )
}
