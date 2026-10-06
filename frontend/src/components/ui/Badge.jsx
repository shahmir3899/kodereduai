import { TONE, statusTone } from './statusTones'

/**
 * Shared status pill. Standardizes the 150+ hand-rolled
 * `rounded-full ... text-xs font-medium` status chips found across pages.
 * Colours live in ui/statusTones.js so pages, cards and badges all agree.
 *
 * Usage:
 *   <Badge tone="success">Active</Badge>
 *   <Badge tone="warning">Pending</Badge>
 *   <Badge tone="danger">Overdue</Badge>
 *   <Badge tone="info">Draft</Badge>
 *   <Badge tone="neutral">Archived</Badge>
 *   <Badge colors={statusBadge[row.status]}>…</Badge>   // page-level map of TONE values
 *   <StatusBadge status="PAID" />        // tone looked up from the status text
 */

export function Badge({ tone = 'neutral', colors, children, className = '', ...props }) {
  // `colors` takes a TONE class string straight from a page's status map (statusBadge[x]); `tone` is the name form.
  const toneClasses = colors || TONE[tone] || TONE.neutral
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${toneClasses} ${className}`} {...props}>
      {children}
    </span>
  )
}

export function StatusBadge({ status, label, tone, ...props }) {
  return (
    <Badge tone={tone || statusTone(status)} {...props}>
      {label ?? String(status ?? '').replace(/_/g, ' ')}
    </Badge>
  )
}

export default Badge
