/**
 * Compute summary data from a list of fee payments.
 * Shared between FeeOverviewPage and FeeCollectPage.
 */
export function computeSummaryData(allPayments, month, year) {
  if (allPayments.length === 0) return null
  const total_due = allPayments.reduce((s, p) => s + Number(p.amount_due), 0)
  const total_collected = allPayments.reduce((s, p) => s + Number(p.amount_paid), 0)
  let paid_count = 0, partial_count = 0, unpaid_count = 0, advance_count = 0
  const classMap = {}
  allPayments.forEach(p => {
    if (p.status === 'PAID') paid_count++
    else if (p.status === 'PARTIAL') partial_count++
    else if (p.status === 'UNPAID') unpaid_count++
    else if (p.status === 'ADVANCE') advance_count++
    const key = p.class_obj_id || p.class_name || 'unknown'
    if (!classMap[key]) {
      classMap[key] = { class_id: p.class_obj_id, class_name: p.class_name || 'Unknown', total_due: 0, total_collected: 0, count: 0 }
    }
    classMap[key].total_due += Number(p.amount_due)
    classMap[key].total_collected += Number(p.amount_paid)
    classMap[key].count++
  })
  return {
    month, year,
    total_due, total_collected,
    total_pending: Math.max(0, total_due - total_collected),
    paid_count, partial_count, unpaid_count, advance_count,
    by_class: Object.values(classMap).sort((a, b) => (a.class_name || '').localeCompare(b.class_name || '')),
  }
}

/**
 * Client-side filter payments by class and status.
 */
export function filterPayments(allPayments, classFilter, statusFilter, classList) {
  let list = allPayments
  if (classFilter) {
    const cid = Number(classFilter)
    const selectedClass = classList.find(c => c.id === cid)
    list = list.filter(p => {
      if (p.class_obj_id != null) return p.class_obj_id === cid
      return selectedClass && p.class_name === selectedClass.name
    })
  }
  if (statusFilter) {
    list = list.filter(p => p.status === statusFilter)
  }
  return list
}
