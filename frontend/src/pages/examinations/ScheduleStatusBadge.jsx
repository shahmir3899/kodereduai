// Planned-vs-taught status from the server's `coverage_status` (null when no
// academic year is in scope, since "late" needs a year's planned date).
const STYLES = {
  not_planned: { label: 'Not planned', cls: 'bg-gray-100 text-gray-600' },
  upcoming: { label: 'Upcoming', cls: 'bg-blue-100 text-blue-700' },
  overdue: { label: 'Overdue', cls: 'bg-red-100 text-red-700' },
  on_time: { label: 'On time', cls: 'bg-green-100 text-green-700' },
  late: { label: 'Late', cls: 'bg-amber-100 text-amber-700' },
  unscheduled: { label: 'Taught (no plan date)', cls: 'bg-gray-100 text-gray-600' },
}

export default function ScheduleStatusBadge({ topic }) {
  const style = STYLES[topic?.coverage_status]
  if (!style) return null
  const days = topic.coverage_days
  const suffix =
    (topic.coverage_status === 'late' || topic.coverage_status === 'overdue') && days > 0
      ? ` · ${days}d`
      : ''
  return <span className={`px-2 py-0.5 text-xs rounded ${style.cls}`}>{style.label}{suffix}</span>
}
