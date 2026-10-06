import Badge from '../ui/Badge'

/**
 * Status pill used inside RecordCard (and standalone). Thin wrapper over
 * ui/Badge so card and table badges share one set of colours (ui/statusTones.js).
 * Kept for the existing `label` + `tone` call sites.
 */
export default function StatusPill({ label, tone = 'neutral', className = '' }) {
  if (!label) return null
  return <Badge tone={tone} className={className}>{label}</Badge>
}
