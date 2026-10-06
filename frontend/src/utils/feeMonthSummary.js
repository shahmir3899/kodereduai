// One definition of "this month's fee collection" for every dashboard. Kept
// free of context imports so AuthContext's prefetch can share the cache key
// without a circular dependency on the hook that reads it.
//
// The 'feeSummary' root is a money root (see financeQueryRules.js): always
// stale, and invalidated by any successful mutation.

// Every dashboard widget labelled "monthly" must ask for exactly this, so the
// fee numbers agree across pages. Annual fees have their own card.
export const MONTHLY_FEE_PARAMS = { fee_type: 'MONTHLY' }

// Annual (and other one-time) fees are stored with month=0 for the year.
export const ANNUAL_FEE_PARAMS = { fee_type: 'ANNUAL' }

export const feeMonthSummaryKey = (scope, month, year, academicYearId, feeType = 'MONTHLY') =>
  ['feeSummary', 'month', scope, month, year, scope === 'single' ? academicYearId ?? null : null, feeType]

const num = (v) => Number(v || 0)

// null (not 0) when nothing is due, so callers can show "—" instead of a fake 0%.
export const collectionRate = (collected, due) => (due > 0 ? Math.round((collected / due) * 100) : null)

const withRate = (row) => {
  const totalDue = num(row.total_due)
  const totalCollected = num(row.total_collected)
  return {
    totalDue,
    totalCollected,
    totalPending: num(row.total_pending ?? Math.max(0, totalDue - totalCollected)),
    rate: collectionRate(totalCollected, totalDue),
  }
}

export function normalizeFeeSummary(raw) {
  if (!raw) return null
  return {
    ...withRate(raw),
    paidCount: num(raw.paid_count),
    partialCount: num(raw.partial_count),
    unpaidCount: num(raw.unpaid_count),
    advanceCount: num(raw.advance_count),
    // One row per fee type (monthly, annual, ...), each with its own rate.
    byType: (raw.by_type || []).map((t) => ({
      feeType: t.fee_type,
      label: t.fee_type_label || t.fee_type,
      count: num(t.count),
      ...withRate(t),
    })),
    byCategory: (raw.by_category || []).map((c) => ({
      id: c.category_id,
      name: c.category_name,
      feeType: c.fee_type,
      count: num(c.count),
      ...withRate(c),
    })),
    byClass: raw.by_class || [],
  }
}

// Single-school responses are the summary itself; the all-schools response
// wraps a per-school list plus a combined `grand`.
export function normalizeFeeMonthResponse(data, isMulti) {
  if (!data) return null
  if (!isMulti) return { ...normalizeFeeSummary(data), schools: [], isMulti: false }
  return {
    ...normalizeFeeSummary(data.grand),
    schools: (data.schools || []).map((s) => ({
      schoolId: s.school_id,
      schoolName: s.school_name,
      ...normalizeFeeSummary(s),
    })),
    isMulti: true,
  }
}
