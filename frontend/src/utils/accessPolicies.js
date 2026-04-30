export function canAccessFinanceRoute(role, { collectOnly = false } = {}) {
  if (role === 'STAFF') return false
  if (role === 'TEACHER') return !!collectOnly
  return true
}

export function canAccessManagementRoute(role, { teacherAllowed = false } = {}) {
  if (role === 'STAFF') return false
  if (role === 'TEACHER') return !!teacherAllowed
  return true
}

export function canAccessInventoryRoute(role, { assignmentsOnly = false } = {}) {
  if (role === 'TEACHER' || role === 'STAFF') return !!assignmentsOnly
  return true
}
