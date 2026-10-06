/**
 * Single source of truth for status-pill colours (bg + text, light + dark).
 * Badge, StatusPill and every page's status→colour map pull from here so a
 * "warning" is the same amber everywhere (the app used to mix yellow/amber and
 * 100/700/800 text shades) and dark mode is covered in one place.
 *
 * Pages keep their own status→tone mapping where the meaning differs
 * (e.g. PENDING is red for fees but amber for leave requests); only the
 * colours behind each tone are shared:
 *   const statusBadge = { PAID: TONE.success, PARTIAL: TONE.warning, UNPAID: TONE.danger }
 *
 * For new code with no special meaning, use statusTone('PAID') / <StatusBadge status="PAID" />.
 */
// Written out in full (not built from the helper) so Tailwind's scanner sees every class.
export const TONE = {
  success: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  danger: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  info: 'bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-300',
  neutral: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  accent: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  indigo: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  sky: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  teal: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
  pink: 'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300',
}

const BY_STATUS = {
  success: ['PAID', 'ACTIVE', 'PRESENT', 'APPROVED', 'COMPLETED', 'RETURNED', 'PUBLISHED', 'ADMITTED', 'ENROLLED', 'RESOLVED', 'SUCCESS'],
  warning: ['PENDING', 'PARTIAL', 'LATE', 'DRAFT', 'ON_LEAVE', 'LEAVE', 'IN_REVIEW', 'PROCESSING'],
  danger: ['UNPAID', 'OVERDUE', 'ABSENT', 'REJECTED', 'TERMINATED', 'LOST', 'FAILED', 'EXPIRED', 'CANCELLED', 'INACTIVE'],
  info: ['ISSUED', 'IN_PROGRESS', 'ADVANCE', 'SCHEDULED', 'OPEN', 'NEW'],
}
const LOOKUP = Object.fromEntries(Object.entries(BY_STATUS).flatMap(([tone, keys]) => keys.map((k) => [k, tone])))

/** Tone name for a status string ('paid', 'On Leave', 'IN_PROGRESS' …); 'neutral' when unknown. */
export function statusTone(status) {
  const key = String(status ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_')
  return LOOKUP[key] || 'neutral'
}

export default TONE
