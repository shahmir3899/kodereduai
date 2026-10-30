// The school's own clock (School.timezone, Asia/Karachi unless the school says otherwise).
// `new Date().toISOString()` is UTC, which is still "yesterday" before 05:00 in Pakistan, and
// getFullYear()/getMonth() follow the browser, not the school. Everything that means "today",
// "this month" or "this year" for the school goes through here.
//
// AuthContext calls setSchoolTimeZone() whenever the active school changes, so plain helpers
// and module-level code can use these without a hook.

export const DEFAULT_SCHOOL_TIME_ZONE = 'Asia/Karachi'

// Zones offered in Settings. A school already on another valid zone still sees its own in the list.
export const TIME_ZONE_CHOICES = [
  'Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Kabul', 'Asia/Tashkent',
  'Europe/Istanbul', 'Europe/London', 'America/New_York', 'America/Chicago', 'America/Los_Angeles',
  'Australia/Sydney', 'UTC',
]

let currentZone = DEFAULT_SCHOOL_TIME_ZONE

function isValidZone(zone) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

export function setSchoolTimeZone(zone) {
  currentZone = zone && isValidZone(zone) ? zone : DEFAULT_SCHOOL_TIME_ZONE
}

export function getSchoolTimeZone() {
  return currentZone
}

function partsOf(date, zone = currentZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const pick = (type) => Number(parts.find((p) => p.type === type).value)
  return { year: pick('year'), month: pick('month'), day: pick('day') }
}

const pad = (n) => String(n).padStart(2, '0')

// 'YYYY-MM-DD' for an instant, as read on the school's calendar.
export function schoolDateStr(date = new Date(), zone = currentZone) {
  const { year, month, day } = partsOf(date, zone)
  return `${year}-${pad(month)}-${pad(day)}`
}

export function schoolToday() {
  return schoolDateStr(new Date())
}

// { year, month (1-12), day } on the school's calendar right now.
export function schoolYMD() {
  return partsOf(new Date())
}

// A Date whose *local* fields (getFullYear, getMonth, getDate, getHours...) read the school's wall
// clock. For calendar defaults such as "current month" only: it is not the real instant, so never
// compare it with timestamps from the server.
export function schoolNowDate() {
  const { year, month, day } = schoolYMD()
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: currentZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date())
  const pick = (type) => Number(time.find((p) => p.type === type).value)
  return new Date(year, month - 1, day, pick('hour'), pick('minute'), pick('second'))
}

const lastDayOf = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate()

// Date ranges for report filters, all on the school's calendar.
export function schoolPeriod(kind) {
  const { year, month } = schoolYMD()
  const today = schoolToday()
  if (kind === 'month') return { date_from: `${year}-${pad(month)}-01`, date_to: today }
  if (kind === 'lastMonth') {
    const y = month === 1 ? year - 1 : year
    const m = month === 1 ? 12 : month - 1
    return { date_from: `${y}-${pad(m)}-01`, date_to: `${y}-${pad(m)}-${pad(lastDayOf(y, m))}` }
  }
  if (kind === 'quarter') return { date_from: `${year}-${pad(Math.floor((month - 1) / 3) * 3 + 1)}-01`, date_to: today }
  if (kind === 'year') return { date_from: `${year}-01-01`, date_to: today }
  throw new Error(`Unknown period: ${kind}`)
}
