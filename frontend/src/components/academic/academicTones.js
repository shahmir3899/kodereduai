import { TONE } from '../ui/statusTones'

/**
 * One place for the colours and wording shared by the academic calendar, the academic years page,
 * the terms screens, the setup wizard and the year switcher. The calendar used to pick its own
 * orange/rose/emerald while the years pages used the theme blue, so the same idea looked different
 * on every screen.
 */

// Pill colours for calendar day cells, the legend and the entry lists. Built on TONE so dark mode
// and the amber/red shades stay in step with every other status pill in the app.
export const ENTRY_TONE = {
  off: TONE.danger,
  offStudents: TONE.warning,
  event: TONE.info,
  exam: TONE.indigo,
  sunday: TONE.neutral,
}

// Solid swatches for the legend dots. Written out in full so Tailwind's scanner sees every class.
export const ENTRY_DOT = {
  off: 'bg-red-400',
  offStudents: 'bg-amber-400',
  event: 'bg-primary-400',
  exam: 'bg-indigo-400',
  sunday: 'bg-gray-300 dark:bg-gray-500',
}

// Colours stored on calendar entries stay as saved; these only apply to new entries and entries with none.
export const DEFAULT_EVENT_COLOR = '#0ea5e9'
export const DEFAULT_OFF_COLOR = '#dc2626'
export const ENTRY_SWATCHES = ['#0ea5e9', '#14b8a6', '#8b5cf6', '#ec4899', '#f59e0b', '#dc2626', '#64748b']

// Written out in full so Tailwind's scanner sees every class.
export const TERM_COLOURS = ['bg-primary-500', 'bg-teal-500', 'bg-amber-500', 'bg-purple-500', 'bg-pink-500', 'bg-sky-500']

// The "today" line on the year bars.
export const TODAY_MARKER = 'bg-red-600'

/**
 * Status pills for an academic year, in one vocabulary everywhere: "Current year" is the year the
 * school runs on, "Viewing" is the one picked in the switcher. A year can be both. A year that is
 * neither is labelled Past or Upcoming from its dates.
 */
export function yearBadges(year, activeYearId, today = new Date().toISOString().slice(0, 10)) {
  const badges = []
  if (year.id === activeYearId) badges.push({ key: 'viewing', label: 'Viewing', tone: 'info' })
  if (year.is_current) badges.push({ key: 'current', label: 'Current year', tone: 'success' })
  else if (year.end_date && year.end_date < today) badges.push({ key: 'past', label: 'Past', tone: 'neutral' })
  else if (year.start_date && year.start_date > today) badges.push({ key: 'upcoming', label: 'Upcoming', tone: 'sky' })
  return badges
}
