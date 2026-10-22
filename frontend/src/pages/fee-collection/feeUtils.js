export function getPaymentClassKey(payment) {
  if (payment?.session_class_id != null) return `session:${payment.session_class_id}`
  if (payment?.session_class_label) return `session:${payment.session_class_label}`
  if (payment?.class_name) return `class:${payment.class_name}`
  if (payment?.class_obj_id != null) return `id:${payment.class_obj_id}`
  return 'unknown'
}

/**
 * Client-side filter payments by class (section when known), status and name/roll search.
 */
export function filterPayments(allPayments, classFilter, statusFilter, classList, sessionClassId, searchQuery) {
  let list = allPayments
  if (classFilter || sessionClassId) {
    const cid = Number(classFilter)
    const scid = sessionClassId ? Number(sessionClassId) : null
    const selectedClass = classList.find(c => c.id === cid)
    list = list.filter(p => {
      // Fees are per section: match the section when both sides know it, so 5-A and 5-B
      // never merge under their shared master class.
      if (scid != null && p.session_class_id != null) return Number(p.session_class_id) === scid
      if (p.class_obj_id != null) return p.class_obj_id === cid
      return selectedClass && p.class_name === selectedClass.name
    })
  }
  if (statusFilter) {
    list = list.filter(p => p.status === statusFilter)
  }
  const q = (searchQuery || '').trim().toLowerCase()
  if (q) {
    list = list.filter(p =>
      (p.student_name || '').toLowerCase().includes(q) ||
      String(p.student_roll ?? p.roll_number ?? '').toLowerCase().includes(q)
    )
  }
  return list
}
