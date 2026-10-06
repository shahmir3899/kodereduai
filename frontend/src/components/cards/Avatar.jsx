import { TONE } from '../ui/statusTones'
/**
 * Initials avatar for RecordCard's leading slot. Deterministic color-from-name
 * so the same person/entity gets the same tint everywhere it's rendered as a card.
 */
const PALETTE = [
  TONE.indigo,
  TONE.teal,
  TONE.warning,
  TONE.danger,
  TONE.sky,
  TONE.accent,
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
