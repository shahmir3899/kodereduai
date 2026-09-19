// Date helpers for the Add/Edit Term form. Dates are ISO "YYYY-MM-DD" strings throughout and
// are handled in UTC so a timezone can never shift a term boundary by a day.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-09-14" -> "14 Sep 2026" (same style the API's validation messages use). */
export function formatDay(iso) {
  if (!iso) return ''
  const [y, m, d] = String(iso).split('-').map(Number)
  if (!y || !m || !d) return String(iso)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

export function addDays(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/**
 * Suggested order and start date for a new term. The first term of a year starts on the
 * academic year's first day; each later term starts the day after the previous one ends.
 * Returns an empty start date when the year is already fully covered.
 */
export function nextTermDefaults(year, yearTerms = []) {
  if (!year) return { order: 1, start_date: '' }
  const order = yearTerms.length ? Math.max(...yearTerms.map(t => Number(t.order) || 0)) + 1 : 1
  const lastEnd = yearTerms.map(t => t.end_date).filter(Boolean).sort().pop()
  const start = lastEnd ? addDays(lastEnd, 1) : year.start_date
  return { order, start_date: start && start <= year.end_date ? start : '' }
}
