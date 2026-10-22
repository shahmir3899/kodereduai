// Turns GET /api/parents/children/<id>/overview/ into what the parent pages
// render, and builds the dashboard's attention chips. Pure on purpose: the
// dashboard once read keys the API never sent (attendance.rate, fees.total_due,
// recent_exams) and showed "N/A" everywhere, so the contract lives in one tested place.

const num = (v) => (v == null || v === '' ? null : Number(v))

export function parseLocalDate(iso) {
  if (!iso) return null
  const [y, m, d] = String(iso).split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Whole days from `now` (local midnight) to the ISO date; 0 = today, negative = past. */
export function daysUntil(iso, now = new Date()) {
  const target = parseLocalDate(iso)
  if (!target) return null
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target - start) / 86400000)
}

export function formatPkr(amount) {
  return `PKR ${Math.round(Number(amount) || 0).toLocaleString()}`
}

const TODAY_LABEL = { PRESENT: 'Present', ABSENT: 'Absent', LATE: 'Late', LEAVE: 'On leave' }

/** The overview response as a flat view-model. `link` is the ParentChild row from my-children. */
export function readOverview(data, link = {}) {
  const o = data || {}
  const att = o.attendance_summary || {}
  const fee = o.fee_summary || {}
  const today = o.today || {}
  const latest = o.latest_exam || null
  const previous = o.previous_exam || null

  const offDayTypes = today.off_day_types || []
  const isOffDay = !!today.is_off_day
  const outstanding = num(fee.outstanding) || 0
  const overdue = num(fee.overdue_amount) || 0

  return {
    name: o.student_name || link.student_name || '',
    className: o.class_name || link.class_name || '',
    rollNumber: o.roll_number || link.student_roll_number || '',

    attendanceRate: num(att.attendance_rate),
    totalDays: att.total_days ?? 0,
    presentDays: att.present ?? 0,
    absentDays: att.absent ?? 0,
    recent: att.recent || [],

    isOffDay,
    offDayTypes,
    offDayLabel: isOffDay ? `School closed${offDayTypes.length ? `: ${offDayTypes.join(', ').replace(/_/g, ' ').toLowerCase()}` : ''}` : null,
    todayStatus: isOffDay ? null : (att.today || null),
    todayLabel: isOffDay ? 'Closed' : (att.today ? (TODAY_LABEL[att.today] || att.today) : 'Not marked yet'),

    outstanding,
    overdue,
    unpaidItems: fee.unpaid_items ?? 0,

    latestExam: latest && { name: latest.exam_name, percentage: num(latest.percentage) },
    examDelta: latest && previous && num(latest.percentage) != null && num(previous.percentage) != null
      ? Math.round((num(latest.percentage) - num(previous.percentage)) * 10) / 10
      : null,
    nextExam: o.next_exam || null,
    pendingLeave: o.pending_leave_count ?? 0,
  }
}

/**
 * Chips for the attention strip. `children` is [{ studentId, vm }] where vm
 * comes from readOverview; children whose overview hasn't loaded are skipped.
 * Chips without a `count` are statements about one child, not tallies.
 */
export function buildParentAttentionItems(children, { unreadMessages = 0, now = new Date() } = {}) {
  const items = []
  let pendingLeave = 0

  for (const { studentId, vm } of children) {
    if (!vm) continue
    const first = (vm.name || 'Your child').split(' ')[0]
    const base = `/parent/children/${studentId}`

    if (vm.todayStatus === 'ABSENT') {
      items.push({ key: `absent-${studentId}`, label: `${first} was marked absent today`, href: `${base}/attendance`, tone: 'red' })
    }
    if (vm.outstanding > 0) {
      items.push({
        key: `fees-${studentId}`,
        label: `${first}: ${formatPkr(vm.outstanding)} fees outstanding${vm.overdue > 0 ? ' (some overdue)' : ''}`,
        href: `${base}/fees`,
        tone: vm.overdue > 0 ? 'red' : 'amber',
      })
    }
    const days = vm.nextExam ? daysUntil(vm.nextExam.exam_date, now) : null
    if (days != null && days >= 0 && days <= 7) {
      const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`
      items.push({ key: `exam-${studentId}`, label: `${first}: ${vm.nextExam.subject_name} exam ${when}`, href: `${base}/exam-schedule`, tone: 'blue' })
    }
    pendingLeave += vm.pendingLeave || 0
  }

  if (pendingLeave > 0) {
    items.push({ key: 'leave', count: pendingLeave, label: `leave request${pendingLeave === 1 ? '' : 's'} awaiting approval`, href: '/parent/leave', tone: 'blue' })
  }
  if (unreadMessages > 0) {
    items.push({ key: 'messages', count: unreadMessages, label: `unread message${unreadMessages === 1 ? '' : 's'}`, href: '/parent/messages', tone: 'amber' })
  }

  const rank = { red: 0, amber: 1, blue: 2 }
  return items.sort((a, b) => rank[a.tone] - rank[b.tone])
}
