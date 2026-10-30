export function canAccessFinanceRoute(role, { collectOnly = false } = {}) {
  // Manager removed 2026-09: nav access scoped down to Dashboard/Academics/
  // Content Creation/Management only — Finance is no longer part of that set.
  if (role === 'STAFF' || role === 'MANAGER') return false
  if (role === 'TEACHER') return !!collectOnly
  return true
}

export function canAccessManagementRoute(role, { teacherAllowed = false } = {}) {
  if (role === 'STAFF') return false
  if (role === 'TEACHER') return !!teacherAllowed
  return true
}

// Promotion moves students between classes: Admin, Principal and Manager run it; Accountant and
// Driver have no part in it (and Teacher/Staff are already outside management pages).
export function canAccessPromotionRoute(role) {
  if (role === 'ACCOUNTANT' || role === 'DRIVER') return false
  return canAccessManagementRoute(role)
}

// Curriculum, Lesson Plans and Assignments are teaching pages. Accountant and Driver have no
// teaching role (and Staff is blocked already): their API calls would only return 403.
export function canAccessLmsRoute(role) {
  return role !== 'ACCOUNTANT' && role !== 'DRIVER' && role !== 'STAFF'
}

export function canAccessInventoryRoute(role, { assignmentsOnly = false } = {}) {
  // Manager removed 2026-09: same scope-down as Finance above.
  if (role === 'MANAGER') return false
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
