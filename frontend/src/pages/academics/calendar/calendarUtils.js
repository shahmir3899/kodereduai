import { DEFAULT_EVENT_COLOR } from '../../../components/academic/academicTones'

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export const OFF_DAY_TYPES = [
  { value: 'SUMMER_VACATION', label: 'Summer Vacation' },
  { value: 'WINTER_VACATION', label: 'Winter Vacation' },
  { value: 'RELIGIOUS_HOLIDAY', label: 'Religious Holiday' },
  { value: 'NATIONAL_HOLIDAY', label: 'National Holiday' },
  { value: 'EXAM_BREAK', label: 'Exam Break' },
  { value: 'OTHER', label: 'Other' },
]

export const EMPTY_FORM = {
  name: '',
  description: '',
  entry_kind: 'EVENT',
  off_day_type: 'OTHER',
  scope: 'SCHOOL',
  start_date: '',
  end_date: '',
  color: DEFAULT_EVENT_COLOR,
  class_ids: [],
  affects_students: true,
  affects_staff: true,
}

export function isoDate(year, month, day) {
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

export function getMonthMeta(year, month) {
  const firstDay = new Date(year, month - 1, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  const startOffset = (firstDay.getDay() + 6) % 7
  return { daysInMonth, startOffset }
}

export function classLabel(cls) {
  return cls.display_name || (cls.section ? `${cls.name} - ${cls.section}` : cls.name)
}

/** "Mon" for a YYYY-MM-DD key, in the same Monday-first style as the grid header. */
export function weekdayLabel(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number)
  return DAY_LABELS[(new Date(y, m - 1, d).getDay() + 6) % 7]
}

/**
 * Month options for the jump menu: every month of the academic year, plus the month being viewed
 * when it falls outside the year, so the select never shows a value it cannot list.
 */
export function monthOptions(academicYear, viewYear, viewMonth) {
  const options = []
  if (academicYear?.start_date && academicYear?.end_date) {
    let [y, m] = academicYear.start_date.split('-').map(Number)
    const [endY, endM] = academicYear.end_date.split('-').map(Number)
    while (y < endY || (y === endY && m <= endM)) {
      options.push({ year: y, month: m, outside: false })
      m += 1
      if (m > 12) { m = 1; y += 1 }
    }
  }
  const viewing = options.some((o) => o.year === viewYear && o.month === viewMonth)
  if (!viewing) {
    options.push({ year: viewYear, month: viewMonth, outside: true })
    options.sort((a, b) => (a.year - b.year) || (a.month - b.month))
  }
  return options
}
