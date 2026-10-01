// Single source of truth for how a notification looks and where it leads.
// The page, bell and carousel all read from here so event types can't drift
// (the page previously listed 9 of the 12 backend event types).

export const TONES = {
  red: { chip: 'bg-red-50 text-red-700', icon: 'bg-red-50 text-red-600' },
  amber: { chip: 'bg-amber-50 text-amber-800', icon: 'bg-amber-50 text-amber-600' },
  green: { chip: 'bg-emerald-50 text-emerald-700', icon: 'bg-emerald-50 text-emerald-600' },
  indigo: { chip: 'bg-indigo-50 text-indigo-700', icon: 'bg-indigo-50 text-indigo-600' },
  teal: { chip: 'bg-teal-50 text-teal-700', icon: 'bg-teal-50 text-teal-600' },
  violet: { chip: 'bg-violet-50 text-violet-700', icon: 'bg-violet-50 text-violet-600' },
  slate: { chip: 'bg-slate-100 text-slate-700', icon: 'bg-slate-100 text-slate-600' },
}

// Mirrors NotificationTemplate.EVENT_TYPE_CHOICES in the backend.
export const EVENT_META = {
  ABSENCE: { label: 'Absence', plural: 'absence alerts', icon: 'absence', tone: 'red' },
  ATTENDANCE_RISK: { label: 'Attendance risk', plural: 'attendance risk alerts', icon: 'risk', tone: 'red' },
  FEE_DUE: { label: 'Fee due', plural: 'fee reminders', icon: 'fee', tone: 'amber' },
  FEE_OVERDUE: { label: 'Fee overdue', plural: 'overdue fees', icon: 'fee', tone: 'red' },
  EXAM_RESULT: { label: 'Result', plural: 'results', icon: 'result', tone: 'green' },
  EXAM_SCHEDULE: { label: 'Exam schedule', plural: 'exam schedule updates', icon: 'schedule', tone: 'indigo' },
  ASSIGNMENT_DUE: { label: 'Assignment', plural: 'assignments due', icon: 'assign', tone: 'indigo' },
  TRANSPORT_UPDATE: { label: 'Transport', plural: 'transport updates', icon: 'transport', tone: 'teal' },
  LIBRARY_OVERDUE: { label: 'Library', plural: 'library reminders', icon: 'library', tone: 'violet' },
  LEAVE_DECISION: { label: 'Leave', plural: 'leave updates', icon: 'leave', tone: 'green' },
  GENERAL: { label: 'Announcement', plural: 'announcements', icon: 'general', tone: 'slate' },
  CUSTOM: { label: 'Message', plural: 'messages', icon: 'general', tone: 'slate' },
}

export const EVENT_TYPE_OPTIONS = Object.entries(EVENT_META).map(([value, m]) => ({ value, label: m.label }))

export function getEventMeta(type) {
  return EVENT_META[type] || { label: type || 'Notification', plural: 'notifications', icon: 'general', tone: 'slate' }
}

// Which event types a role cares about most; earlier = more prominent.
const ROLE_PRIORITY = {
  SCHOOL_ADMIN: ['ATTENDANCE_RISK', 'FEE_OVERDUE', 'ABSENCE', 'LEAVE_DECISION', 'EXAM_RESULT'],
  PRINCIPAL: ['ATTENDANCE_RISK', 'FEE_OVERDUE', 'ABSENCE', 'LEAVE_DECISION', 'EXAM_RESULT'],
  MANAGER: ['ATTENDANCE_RISK', 'FEE_OVERDUE', 'ABSENCE', 'TRANSPORT_UPDATE'],
  ACCOUNTANT: ['FEE_OVERDUE', 'FEE_DUE', 'GENERAL'],
  TEACHER: ['ASSIGNMENT_DUE', 'ABSENCE', 'EXAM_SCHEDULE', 'LEAVE_DECISION'],
  STAFF: ['LEAVE_DECISION', 'GENERAL', 'EXAM_SCHEDULE'],
  PARENT: ['FEE_DUE', 'FEE_OVERDUE', 'ABSENCE', 'EXAM_RESULT', 'TRANSPORT_UPDATE', 'ASSIGNMENT_DUE'],
  STUDENT: ['ASSIGNMENT_DUE', 'EXAM_SCHEDULE', 'EXAM_RESULT', 'LIBRARY_OVERDUE'],
  DRIVER: ['TRANSPORT_UPDATE', 'GENERAL'],
}

export function sortForRole(items, role) {
  const priority = ROLE_PRIORITY[role] || []
  const rank = (t) => {
    const i = priority.indexOf(t)
    return i < 0 ? priority.length : i
  }
  return [...items].sort((a, b) => {
    if (a.is_read !== b.is_read) return a.is_read ? 1 : -1
    const r = rank(a.event_type) - rank(b.event_type)
    if (r) return r
    return new Date(b.created_at) - new Date(a.created_at)
  })
}

// Colour stripe per school. Derived from the id so no schema change is needed
// and the same school is the same colour everywhere.
const SCHOOL_COLORS = ['#0d9488', '#a855f7', '#f59e0b', '#2563eb', '#e11d48', '#65a30d', '#0891b2', '#c026d3']
export const NEUTRAL_STRIPE = '#cbd5e1'

export function schoolColor(schoolId) {
  const n = Number(schoolId)
  if (!Number.isFinite(n)) return NEUTRAL_STRIPE
  return SCHOOL_COLORS[Math.abs(n) % SCHOOL_COLORS.length]
}

export function timeAgo(dateStr, now = Date.now()) {
  if (!dateStr) return ''
  const mins = Math.floor((now - new Date(dateStr).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function initials(name) {
  if (!name) return ''
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
}

const groupKey = (n) => {
  const d = new Date(n.created_at)
  return `${n.event_type}|${n.school}|${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export const BUNDLE_MIN_SIZE = 3
// A bundle lists this many members inline; the rest sit behind "Show all".
export const BUNDLE_PREVIEW = 3

const AMOUNT_RE = /Rs\.?\s*([\d,]+(?:\.\d+)?)/i

export function parseAmount(text) {
  const m = AMOUNT_RE.exec(text || '')
  return m ? Number(m[1].replace(/,/g, '')) : null
}

// Sum of the amounts in a fee bundle, or null if any member has none
// (a partial total would mislead).
function feeTotal(group) {
  if (!['FEE_DUE', 'FEE_OVERDUE'].includes(group[0].event_type)) return null
  const amounts = group.map((g) => parseAmount(g.body))
  return amounts.every((a) => a !== null) ? amounts.reduce((x, y) => x + y, 0) : null
}

/**
 * Collapse repeated alerts (same type, same school, same calendar day) into
 * one card so an admin's 12 absence alerts don't take 12 slides.
 * A bundle takes the position of its first member, keeping the incoming order.
 */
export function bundleNotifications(items, minSize = BUNDLE_MIN_SIZE) {
  const groups = new Map()
  items.forEach((n) => {
    const key = groupKey(n)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(n)
  })

  const emitted = new Set()
  const out = []
  items.forEach((n) => {
    const key = groupKey(n)
    const group = groups.get(key)
    if (group.length < minSize) {
      out.push(n)
      return
    }
    if (emitted.has(key)) return
    emitted.add(key)

    const meta = getEventMeta(n.event_type)
    out.push({
      id: `bundle-${key}`,
      bundle: true,
      event_type: n.event_type,
      school: n.school,
      school_name: n.school_name,
      created_at: group.reduce((a, g) => (new Date(g.created_at) > new Date(a) ? g.created_at : a), group[0].created_at),
      is_read: group.every((g) => g.is_read),
      count: group.length,
      title: `${group.length} ${meta.plural}`,
      // Never summarise the members away: names and amounts live in their own
      // title/body, so the card lists them. Only a fee total is derived.
      total: feeTotal(group),
      children: group,
    })
  })
  return out
}

/**
 * Where tapping a notification goes. Only routes that already exist in App.jsx;
 * returns null when there is no sensible destination for the role.
 */
export function getNotificationPath(n, role) {
  const sid = n.student
  const type = n.event_type
  if (role === 'PARENT') {
    const child = (suffix) => (sid ? `/parent/children/${sid}/${suffix}` : '/parent/dashboard')
    switch (type) {
      case 'ABSENCE': case 'ATTENDANCE_RISK': return child('attendance')
      case 'FEE_DUE': case 'FEE_OVERDUE': return child('fees')
      case 'EXAM_RESULT': return child('results')
      case 'EXAM_SCHEDULE': return child('exam-schedule')
      case 'LIBRARY_OVERDUE': return child('library')
      case 'TRANSPORT_UPDATE': return child('transport')
      case 'LEAVE_DECISION': return '/parent/leave'
      default: return null
    }
  }
  if (role === 'STUDENT') {
    const map = {
      ABSENCE: '/student/attendance', ATTENDANCE_RISK: '/student/attendance',
      FEE_DUE: '/student/fees', FEE_OVERDUE: '/student/fees',
      EXAM_RESULT: '/student/results', EXAM_SCHEDULE: '/student/exam-schedule',
      ASSIGNMENT_DUE: '/student/assignments', LIBRARY_OVERDUE: '/student/library',
      TRANSPORT_UPDATE: '/student/transport',
    }
    return map[type] || null
  }
  if (role === 'DRIVER') return null
  const map = {
    ABSENCE: '/attendance', ATTENDANCE_RISK: '/attendance/at-risk',
    FEE_DUE: '/finance/fees', FEE_OVERDUE: '/finance/fees',
    EXAM_RESULT: '/academics/results', EXAM_SCHEDULE: '/academics/exam-schedule',
    ASSIGNMENT_DUE: '/academics/assignments', LIBRARY_OVERDUE: '/library/overdue',
    TRANSPORT_UPDATE: '/transport', LEAVE_DECISION: '/hr/leave',
  }
  return map[type] || null
}
