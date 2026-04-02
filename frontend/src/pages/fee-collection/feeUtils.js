import {
  buildClassOrderMaps,
  compareClassLabels,
  getClassSortMeta,
} from '../../utils/classOrdering'

/**
 * Compute summary data from a list of fee payments.
 * Shared between FeeOverviewPage and FeeCollectPage.
 */

export function getPaymentClassKey(payment) {
  if (payment?.session_class_id != null) return `session:${payment.session_class_id}`
  if (payment?.session_class_label) return `session:${payment.session_class_label}`
  if (payment?.class_name) return `class:${payment.class_name}`
  if (payment?.class_obj_id != null) return `id:${payment.class_obj_id}`
  return 'unknown'
}

export function computeSummaryData(allPayments, month, year, options = {}) {
  if (allPayments.length === 0) return null
  const classOrderMaps = buildClassOrderMaps(options)
  const total_due = allPayments.reduce((s, p) => s + Number(p.amount_due), 0)
  const total_collected = allPayments.reduce((s, p) => s + Number(p.amount_paid), 0)
  let paid_count = 0, partial_count = 0, unpaid_count = 0, advance_count = 0
  const classMap = {}
  const categoryMap = {}
  allPayments.forEach(p => {
    if (p.status === 'PAID') paid_count++
    else if (p.status === 'PARTIAL') partial_count++
    else if (p.status === 'UNPAID') unpaid_count++
    else if (p.status === 'ADVANCE') advance_count++
    const key = getPaymentClassKey(p)
    const className = p.session_class_label || p.class_name || 'Unknown'
    if (!classMap[key]) {
      classMap[key] = {
        class_key: key,
        class_id: p.class_obj_id,
        session_class_id: p.session_class_id,
        class_name: className,
        total_due: 0,
        total_collected: 0,
        count: 0,
      }
    }
    classMap[key].total_due += Number(p.amount_due)
    classMap[key].total_collected += Number(p.amount_paid)
    classMap[key].count++

    const categoryId = p.monthly_category || p.annual_category || null
    const categoryName = p.monthly_category_name || p.annual_category_name || 'Uncategorized'
    const categoryKey = categoryId || categoryName || 'uncategorized'
    if (!categoryMap[categoryKey]) {
      categoryMap[categoryKey] = {
        category_id: categoryId,
        category_name: categoryName,
        total_due: 0,
        total_collected: 0,
        count: 0,
      }
    }
    categoryMap[categoryKey].total_due += Number(p.amount_due)
    categoryMap[categoryKey].total_collected += Number(p.amount_paid)
    categoryMap[categoryKey].count++
  })

  return {
    month, year,
    total_students: allPayments.length,
    total_due, total_collected,
    total_pending: Math.max(0, total_due - total_collected),
    paid_count, partial_count, unpaid_count, advance_count,
    by_class: Object.values(classMap).sort((a, b) => {
      const aMeta = getClassSortMeta(a, classOrderMaps)
      const bMeta = getClassSortMeta(b, classOrderMaps)
      if (aMeta.level !== bMeta.level) return aMeta.level - bMeta.level
      if (aMeta.sectionOrder !== bMeta.sectionOrder) return aMeta.sectionOrder - bMeta.sectionOrder
      return compareClassLabels(a.class_name, b.class_name)
    }),
    by_category: Object.values(categoryMap).sort((a, b) => (a.category_name || '').localeCompare(b.category_name || '')),
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
