import { describe, it, expect } from 'vitest'
import {
  bundleNotifications,
  sortForRole,
  getNotificationPath,
  schoolColor,
  NEUTRAL_STRIPE,
  timeAgo,
} from '../notificationMeta'

const n = (id, over = {}) => ({
  id,
  event_type: 'ABSENCE',
  school: 1,
  school_name: 'Branch 1',
  student: 10 + id,
  student_name: `Student ${id}`,
  title: `t${id}`,
  is_read: false,
  created_at: '2026-05-05T09:00:00',
  ...over,
})

describe('bundleNotifications', () => {
  it('leaves groups smaller than the minimum untouched', () => {
    const items = [n(1), n(2)]
    expect(bundleNotifications(items)).toEqual(items)
  })

  it('collapses 3+ same type/school/day into one bundle at the first position', () => {
    const items = [n(1), n(2, { event_type: 'GENERAL' }), n(3), n(4)]
    const out = bundleNotifications(items)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ bundle: true, count: 3, title: '3 absence alerts' })
    // members keep their own title/body so names and amounts are never summarised away
    expect(out[0].children.map((c) => c.id)).toEqual([1, 3, 4])
    expect(out[1].id).toBe(2)
  })

  it('keeps different schools or days separate', () => {
    const items = [n(1), n(2, { school: 2 }), n(3, { created_at: '2026-05-04T09:00:00' }), n(4)]
    expect(bundleNotifications(items)).toHaveLength(4)
  })

  it('is read only when every member is read', () => {
    const items = [n(1, { is_read: true }), n(2, { is_read: true }), n(3)]
    expect(bundleNotifications(items)[0].is_read).toBe(false)
  })
})

describe('fee bundle totals', () => {
  const fee = (id, body, over = {}) => n(id, { event_type: 'FEE_DUE', student_name: null, body, ...over })

  it('sums the Rs amounts from member bodies', () => {
    const out = bundleNotifications([
      fee(1, 'An amount of Rs 40,800 is pending for Class 5.'),
      fee(2, 'An amount of Rs 46,300 is pending for Class 4.'),
      fee(3, 'An amount of Rs 1,000 is pending for Class 3.'),
    ])
    expect(out[0].total).toBe(88100)
  })

  it('gives no total when a member has no amount', () => {
    const out = bundleNotifications([fee(1, 'Rs 500 pending'), fee(2, 'Fee reminder'), fee(3, 'Rs 5 pending')])
    expect(out[0].total).toBeNull()
  })

  it('does not total non-fee bundles', () => {
    expect(bundleNotifications([n(1), n(2), n(3)])[0].total).toBeNull()
  })
})

describe('sortForRole', () => {
  it('puts unread first, then role priority, then newest', () => {
    const items = [
      n(1, { event_type: 'GENERAL', is_read: true }),
      n(2, { event_type: 'GENERAL' }),
      n(3, { event_type: 'FEE_DUE' }),
    ]
    expect(sortForRole(items, 'PARENT').map((x) => x.id)).toEqual([3, 2, 1])
  })
})

describe('getNotificationPath', () => {
  it('sends parents to the child-scoped page', () => {
    expect(getNotificationPath({ event_type: 'FEE_DUE', student: 7 }, 'PARENT')).toBe('/parent/children/7/fees')
  })
  it('falls back to the parent dashboard without a student', () => {
    expect(getNotificationPath({ event_type: 'ABSENCE' }, 'PARENT')).toBe('/parent/dashboard')
  })
  it('returns null where nothing fits', () => {
    expect(getNotificationPath({ event_type: 'FEE_DUE' }, 'DRIVER')).toBeNull()
  })
})

describe('helpers', () => {
  it('derives a stable school colour and a neutral fallback', () => {
    expect(schoolColor(3)).toBe(schoolColor(3))
    expect(schoolColor(undefined)).toBe(NEUTRAL_STRIPE)
  })
  it('formats relative time', () => {
    const now = new Date('2026-05-05T12:00:00').getTime()
    expect(timeAgo('2026-05-05T09:00:00', now)).toBe('3h ago')
  })
})
