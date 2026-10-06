import { describe, it, expect } from 'vitest'
import { feeMonthSummaryKey, normalizeFeeMonthResponse } from '../feeMonthSummary'

const single = {
  total_due: '7000', total_collected: '3000', total_pending: '4000',
  paid_count: 1, partial_count: 1, unpaid_count: 1,
  by_type: [
    { fee_type: 'MONTHLY', fee_type_label: 'Monthly', total_due: '2000', total_collected: '1000', total_pending: '1000', count: 2 },
    { fee_type: 'ANNUAL', fee_type_label: 'Annual', total_due: '5000', total_collected: '2000', total_pending: '3000', count: 1 },
  ],
  by_category: [{ category_id: 1, category_name: 'Tuition', fee_type: 'MONTHLY', total_due: '2000', total_collected: '1000', count: 2 }],
}

describe('normalizeFeeMonthResponse', () => {
  it('turns a single-school response into numbers with one rate per fee type', () => {
    const s = normalizeFeeMonthResponse(single, false)
    expect(s.rate).toBe(43)
    expect(s.totalPending).toBe(4000)
    expect([s.paidCount, s.partialCount, s.unpaidCount]).toEqual([1, 1, 1])
    expect(s.byType.map((t) => [t.feeType, t.rate])).toEqual([['MONTHLY', 50], ['ANNUAL', 40]])
    expect(s.isMulti).toBe(false)
  })

  it('reads the combined grand total and keeps per-school rows for multi-school', () => {
    const s = normalizeFeeMonthResponse({
      schools: [{ school_id: 1, school_name: 'A', ...single }],
      grand: { ...single, total_due: '9000', total_collected: '4500', total_pending: '4500' },
    }, true)
    expect(s.rate).toBe(50)
    expect(s.isMulti).toBe(true)
    expect(s.schools).toHaveLength(1)
    expect(s.schools[0]).toMatchObject({ schoolId: 1, schoolName: 'A', rate: 43 })
  })

  it('has no rate (not 0%) when nothing is due', () => {
    expect(normalizeFeeMonthResponse({ total_due: '0', total_collected: '0' }, false).rate).toBeNull()
  })

  it('returns null before data arrives', () => {
    expect(normalizeFeeMonthResponse(undefined, false)).toBeNull()
  })
})

describe('feeMonthSummaryKey', () => {
  it('ignores the academic year for all-schools (year ids are per school)', () => {
    expect(feeMonthSummaryKey('all', 3, 2026, 9)).toEqual(feeMonthSummaryKey('all', 3, 2026, 10))
    expect(feeMonthSummaryKey('single', 3, 2026, 9)).not.toEqual(feeMonthSummaryKey('single', 3, 2026, 10))
  })
})
