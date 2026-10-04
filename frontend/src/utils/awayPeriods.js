// A student's recorded absences: { start, end, reason }. start is the first day
// away, end the first day back (null while still away). A day is away when
// start <= day < end. ISO dates compare correctly as strings.

const pad = (n) => String(n).padStart(2, '0')

export const isoDay = (year, month0, day) => `${year}-${pad(month0 + 1)}-${pad(day)}`

export const isAwayOn = (periods, iso) => (periods || []).some(
  (p) => p.start <= iso && (!p.end || iso < p.end),
)

// Days of month (1..daysInMonth) a student was away. month0 is 0-indexed, like the register.
export function awayDaysInMonth(periods, year, month0, daysInMonth) {
  const days = new Set()
  if (!periods?.length) return days
  for (let d = 1; d <= daysInMonth; d += 1) {
    if (isAwayOn(periods, isoDay(year, month0, d))) days.add(d)
  }
  return days
}

const fmt = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

// "1 Mar 2026 to 19 Mar 2026 (19 days)" or "since 1 Mar 2026 (not yet back)"
export function describeAway(period) {
  if (!period.end) return `since ${fmt(period.start)} (not yet back)`
  const days = Math.round((new Date(`${period.end}T00:00:00`) - new Date(`${period.start}T00:00:00`)) / 86400000)
  return `${fmt(period.start)} to ${fmt(period.end)} (${days} day${days === 1 ? '' : 's'}; back on ${fmt(period.end)})`
}
