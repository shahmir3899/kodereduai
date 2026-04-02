import { describe, expect, it } from 'vitest'
import { computeSummaryData, getPaymentClassKey } from '../feeUtils'

describe('feeUtils regression', () => {
  it('getPaymentClassKey preserves priority for session/class ids', () => {
    expect(getPaymentClassKey({ session_class_id: 5, class_name: 'Class 1 - A' })).toBe('session:5')
    expect(getPaymentClassKey({ session_class_label: 'Class 1 - A' })).toBe('session:Class 1 - A')
    expect(getPaymentClassKey({ class_name: 'Class 1' })).toBe('class:Class 1')
    expect(getPaymentClassKey({ class_obj_id: 10 })).toBe('id:10')
  })

  it('computeSummaryData keeps existing totals and status counts', () => {
    const rows = [
      {
        id: 1,
        session_class_id: 11,
        session_class_label: 'Class 2 - A',
        class_obj_id: 2,
        class_name: 'Class 2 - A',
        amount_due: '1000',
        amount_paid: '600',
        status: 'PARTIAL',
      },
      {
        id: 2,
        session_class_id: 12,
        session_class_label: 'Class 2 - B',
        class_obj_id: 2,
        class_name: 'Class 2 - B',
        amount_due: '1000',
        amount_paid: '1000',
        status: 'PAID',
      },
    ]

    const summary = computeSummaryData(rows, 4, 2026, {
      sessionClasses: [
        { id: 11, display_name: 'Class 2', section: 'A', grade_level: 4, label: 'Class 2 - A' },
        { id: 12, display_name: 'Class 2', section: 'B', grade_level: 4, label: 'Class 2 - B' },
      ],
    })

    expect(summary.total_students).toBe(2)
    expect(summary.total_due).toBe(2000)
    expect(summary.total_collected).toBe(1600)
    expect(summary.total_pending).toBe(400)
    expect(summary.paid_count).toBe(1)
    expect(summary.partial_count).toBe(1)
    expect(summary.unpaid_count).toBe(0)
    expect(summary.advance_count).toBe(0)
    expect(summary.by_class.map(c => c.class_name)).toEqual(['Class 2 - A', 'Class 2 - B'])
  })

  it('computeSummaryData still works without ordering options', () => {
    const summary = computeSummaryData([
      { id: 1, class_name: 'Class 1', amount_due: 100, amount_paid: 50, status: 'PARTIAL' },
    ], 4, 2026)

    expect(summary).toMatchObject({
      month: 4,
      year: 2026,
      total_students: 1,
      total_due: 100,
      total_collected: 50,
      total_pending: 50,
      partial_count: 1,
    })
  })
})
