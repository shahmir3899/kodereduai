export function canAccessFinanceRoute(role, { collectOnly = false, canManageFinance = false } = {}) {
  // A Manager reaches Finance only with the can_manage_finance capability (the former Finance manager).
  if (role === 'MANAGER') return !!canManageFinance
  if (role === 'STAFF') return false
  if (role === 'TEACHER') return !!collectOnly
  return true
}

export function canAccessManagementRoute(role, { teacherAllowed = false } = {}) {
  if (role === 'STAFF') return false
  if (role === 'TEACHER') return !!teacherAllowed
  return true
}

// Promotion moves students between classes: Admin, Principal and Manager run it; Driver has no
// part in it (and Teacher/Staff are already outside management pages).
export function canAccessPromotionRoute(role) {
  if (role === 'DRIVER') return false
  return canAccessManagementRoute(role)
}

// Curriculum, Lesson Plans and Assignments are teaching pages. Driver has no teaching role (and
// Staff is blocked already): their API calls would only return 403.
export function canAccessLmsRoute(role) {
  return role !== 'DRIVER' && role !== 'STAFF'
}

export function canAccessInventoryRoute(role, { assignmentsOnly = false, canManageFinance = false } = {}) {
  // Same rule as Finance above: a Manager needs the finance capability.
  if (role === 'MANAGER') return !!canManageFinance
  if (role === 'TEACHER' || role === 'STAFF') return !!assignmentsOnly
  return true
}

// Deleting a student record, changing lifecycle status, or reclassifying to
// another class stay admin/principal-only even though TEACHER can otherwise
// edit profile fields, upload photos, and create portal accounts for their
// own students (see backend core.permissions.CanEditStudentRecord).
export function canManageStudentLifecycle(role) {
  return role === 'SUPER_ADMIN' || role === 'SCHOOL_ADMIN' || role === 'PRINCIPAL'
}
