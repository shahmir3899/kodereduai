// Date maths for the year/term timelines. Dates are ISO "YYYY-MM-DD" strings handled in UTC so a
// timezone can never shift a boundary by a day (same rule as pages/sessions/termDefaults.js).

const DAY_MS = 86400000

/** Whole days since 1970-01-01 for an ISO date; NaN when it is empty or invalid. */
export function dayNumber(iso) {
  if (!iso) return NaN
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS)
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

/** Position of a date inside [rangeStart, rangeEnd] as 0-100, clamped. */
export function positionPercent(iso, rangeStart, rangeEnd) {
  const total = dayNumber(rangeEnd) - dayNumber(rangeStart)
  if (!(total > 0)) return 0
  const pct = ((dayNumber(iso) - dayNumber(rangeStart)) / total) * 100
  return Math.min(100, Math.max(0, pct))
}

/**
 * Left/width (in %) of a start..end span drawn on [rangeStart, rangeEnd]. The end day is drawn
 * as a whole day, so a one-day span is still visible and back-to-back terms touch exactly.
 */
export function spanStyle(start, end, rangeStart, rangeEnd) {
  const total = dayNumber(rangeEnd) - dayNumber(rangeStart) + 1
  if (!(total > 0) || Number.isNaN(dayNumber(start)) || Number.isNaN(dayNumber(end))) return null
  const left = ((dayNumber(start) - dayNumber(rangeStart)) / total) * 100
  const right = ((dayNumber(end) - dayNumber(rangeStart) + 1) / total) * 100
  const clampedLeft = Math.min(100, Math.max(0, left))
  const clampedRight = Math.min(100, Math.max(0, right))
  return { left: clampedLeft, width: Math.max(0, clampedRight - clampedLeft) }
}

/**
 * Same rule as the server (TermCreateSerializer / AcademicYearCreateSerializer): two spans clash
 * when one starts before the other ends. A span that starts on another's end date touches it and
 * is not an overlap.
 */
export function spansOverlap(a, b) {
  return a.start_date < b.end_date && a.end_date > b.start_date
}

/** Ids of every item that overlaps at least one other item. */
export function findOverlaps(items) {
  const clashing = new Set()
  items.forEach((a, i) => {
    items.slice(i + 1).forEach(b => {
      if (spansOverlap(a, b)) { clashing.add(a.id); clashing.add(b.id) }
    })
  })
  return clashing
}

/**
 * Stretches of [rangeStart, rangeEnd] that no item covers, as {start_date, end_date, days}. Items are
 * expected to be inclusive on both ends, so a term that starts the day after the previous one ends leaves no gap.
 */
export function findGaps(items, rangeStart, rangeEnd) {
  const gaps = []
  const sorted = [...items].filter(i => i.start_date && i.end_date).sort((a, b) => a.start_date.localeCompare(b.start_date))
  let covered = dayNumber(rangeStart) - 1 // last day accounted for
  const push = (from, to) => {
    if (to >= from) gaps.push({ start: from, end: to, days: to - from + 1 })
  }
  sorted.forEach(item => {
    push(covered + 1, dayNumber(item.start_date) - 1)
    covered = Math.max(covered, dayNumber(item.end_date))
  })
  push(covered + 1, dayNumber(rangeEnd))
  return gaps.map(g => ({
    start_date: new Date(g.start * DAY_MS).toISOString().slice(0, 10),
    end_date: new Date(g.end * DAY_MS).toISOString().slice(0, 10),
    days: g.days,
  }))
}

/**
 * Which years the all-years strip shows by default: `size` rows around the current year (or the year
 * nearest today when none is current), so ten years of history never become ten rows.
 * `years` must be sorted by start_date.
 */
export function pickYearWindow(years, size = 3, today = todayIso()) {
  if (years.length <= size) return years
  let anchor = years.findIndex(y => y.is_current)
  if (anchor < 0) {
    const t = dayNumber(today)
    const distance = y => (t < dayNumber(y.start_date) ? dayNumber(y.start_date) - t : Math.max(0, t - dayNumber(y.end_date)))
    anchor = years.reduce((best, y, i) => (distance(y) < distance(years[best]) ? i : best), 0)
  }
  // One year before the anchor, the rest after; slide the window back in when it hits either end.
  const start = Math.min(Math.max(0, anchor - 1), years.length - size)
  return years.slice(start, start + size)
}
