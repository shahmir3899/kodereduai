import { describe, it, expect } from 'vitest'
import { readOverview, buildParentAttentionItems, daysUntil, formatPkr } from '../parentOverviewUtils'

// The exact shape ChildOverviewView returns (backend/parents/overview.py).
const API = {
  student_id: 7,
  student_name: 'Ayesha Khan',
  class_name: 'Grade 1 - A',
  roll_number: '12',
  attendance_summary: {
    total_days: 20, present: 17, absent: 3, leave: 0, attendance_rate: 85.0, today: 'ABSENT',
    recent: [{ date: '2025-09-29', status: 'PRESENT' }, { date: '2025-10-01', status: 'ABSENT' }],
  },
  fee_summary: { outstanding: '1500.00', overdue_amount: '1000.00', unpaid_items: 1, total_paid: '500.00' },
  latest_exam: { exam_id: 2, exam_name: 'Final', percentage: 70.0, start_date: '2025-09-15' },
  previous_exam: { exam_id: 1, exam_name: 'Mid Term', percentage: 60.0, start_date: '2025-08-01' },
  next_exam: { exam_name: 'Final', subject_name: 'Maths', exam_date: '2025-10-03', start_time: '09:00:00' },
  today: { date: '2025-10-01', is_off_day: false, off_day_types: [] },
  pending_leave_count: 2,
}
const NOW = new Date(2025, 9, 1, 10, 0)

describe('readOverview', () => {
  it('maps the real API shape (the old page read keys that never existed)', () => {
    const vm = readOverview(API)
    expect(vm).toMatchObject({
      name: 'Ayesha Khan', className: 'Grade 1 - A', rollNumber: '12',
      attendanceRate: 85, totalDays: 20, presentDays: 17, todayStatus: 'ABSENT', todayLabel: 'Absent',
      outstanding: 1500, overdue: 1000, unpaidItems: 1, pendingLeave: 2,
      latestExam: { name: 'Final', percentage: 70 }, examDelta: 10,
    })
    expect(vm.nextExam.subject_name).toBe('Maths')
  })

  it('treats a closed school as closed, not "not marked"', () => {
    const vm = readOverview({ ...API, today: { date: '2025-10-01', is_off_day: true, off_day_types: ['NATIONAL_HOLIDAY'] } })
    expect(vm.isOffDay).toBe(true)
    expect(vm.todayStatus).toBeNull()
    expect(vm.todayLabel).toBe('Closed')
    expect(vm.offDayLabel).toBe('School closed: national holiday')
  })

  it('handles a child with no data yet', () => {
    const vm = readOverview({ student_name: 'New Kid', attendance_summary: { attendance_rate: null, total_days: 0, recent: [] } })
    expect(vm.attendanceRate).toBeNull()
    expect(vm.todayLabel).toBe('Not marked yet')
    expect(vm.outstanding).toBe(0)
    expect(vm.latestExam).toBeNull()
    expect(vm.examDelta).toBeNull()
  })

  it('falls back to the my-children row for name and class', () => {
    expect(readOverview(undefined, { student_name: 'Zed', class_name: 'G2' })).toMatchObject({ name: 'Zed', className: 'G2' })
  })
})

describe('buildParentAttentionItems', () => {
  const kid = (over = {}) => ({ studentId: 7, vm: { ...readOverview(API), ...over } })

  it('flags absence today, fees, an exam this week and pending leave, most urgent first', () => {
    const items = buildParentAttentionItems([kid()], { now: NOW })
    expect(items.map((i) => i.key)).toEqual(['absent-7', 'fees-7', 'exam-7', 'leave'])
    expect(items[0]).toMatchObject({ label: 'Ayesha was marked absent today', href: '/parent/children/7/attendance', tone: 'red' })
    expect(items[1].label).toBe('Ayesha: PKR 1,500 fees outstanding (some overdue)')
    expect(items[2].label).toBe('Ayesha: Maths exam in 2 days')
    expect(items[3]).toMatchObject({ count: 2, label: 'leave requests awaiting approval' })
  })

  it('adds unread messages and skips zero counts', () => {
    const items = buildParentAttentionItems([kid({ todayStatus: 'PRESENT', outstanding: 0, nextExam: null, pendingLeave: 0 })], { unreadMessages: 3, now: NOW })
    expect(items).toEqual([{ key: 'messages', count: 3, label: 'unread messages', href: '/parent/messages', tone: 'amber' }])
  })

  it('does not flag an exam more than a week away or already past', () => {
    const far = kid({ nextExam: { subject_name: 'Maths', exam_date: '2025-10-20' } })
    const past = kid({ nextExam: { subject_name: 'Maths', exam_date: '2025-09-20' } })
    expect(buildParentAttentionItems([far, past], { now: NOW }).some((i) => i.key.startsWith('exam'))).toBe(false)
  })

  it('names each child and sums leave across children', () => {
    const second = { studentId: 8, vm: { ...readOverview({ ...API, student_name: 'Bilal Khan' }), todayStatus: 'ABSENT', pendingLeave: 1 } }
    const items = buildParentAttentionItems([kid(), second], { now: NOW })
    expect(items.filter((i) => i.key.startsWith('absent')).map((i) => i.label)).toEqual([
      'Ayesha was marked absent today', 'Bilal was marked absent today',
    ])
    expect(items.find((i) => i.key === 'leave').count).toBe(3)
  })

  it('skips children whose overview has not loaded', () => {
    expect(buildParentAttentionItems([{ studentId: 7, vm: null }], { now: NOW })).toEqual([])
  })
})

describe('helpers', () => {
  it('daysUntil counts whole local days', () => {
    expect(daysUntil('2025-10-01', NOW)).toBe(0)
    expect(daysUntil('2025-10-02', NOW)).toBe(1)
    expect(daysUntil('2025-09-30', NOW)).toBe(-1)
    expect(daysUntil(null, NOW)).toBeNull()
  })
  it('formatPkr rounds and groups', () => expect(formatPkr('12345.6')).toBe('PKR 12,346'))
})
