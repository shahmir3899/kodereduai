/**
 * Initials avatar for RecordCard's leading slot. Deterministic color-from-name
 * so the same person/entity gets the same tint everywhere it's rendered as a card.
 */
const PALETTE = [
  'bg-indigo-100 text-indigo-700',
  'bg-teal-100 text-teal-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
]

function hashName(name) {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function getInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join('')
}

export default function Avatar({ name, className = '' }) {
  const colorClass = PALETTE[hashName(name || '') % PALETTE.length]
  return (
    <div
      className={`flex-none w-9 h-9 rounded-lg flex items-center justify-center text-sm font-semibold ${colorClass} ${className}`}
      aria-hidden="true"
    >
      {getInitials(name)}
    </div>
  )
}
