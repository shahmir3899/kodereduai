// Shared labels/styles for Student.status (backend/students/models.py Student.Status)
// and StudentEnrollment.status. Single source so a status reads the same way
// wherever it's shown — StudentsPage's roster table, the fee-collection
// class breakdown's "left" sub-group, etc.

export const LIFECYCLE_LABELS = {
  ACTIVE: 'Active',
  REPEAT: 'Repeat',
  TRANSFERRED: 'Transferred',
  WITHDRAWN: 'Withdrawn',
  GRADUATED: 'Graduated',
  SUSPENDED: 'Suspended',
}

export const LIFECYCLE_STYLES = {
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  REPEAT: 'bg-amber-100 text-amber-800',
  TRANSFERRED: 'bg-sky-100 text-sky-800',
  WITHDRAWN: 'bg-rose-100 text-rose-800',
  GRADUATED: 'bg-indigo-100 text-indigo-800',
  SUSPENDED: 'bg-red-100 text-red-800',
}

export const getLifecycleLabel = (status) => LIFECYCLE_LABELS[status] || status || 'Unknown'
export const getLifecycleStyle = (status) => LIFECYCLE_STYLES[status] || 'bg-gray-100 text-gray-700'

// A student counts as "left" (no longer currently enrolled) for any status
// other than ACTIVE/REPEAT — mirrors the is_left check in
// backend/finance/views.py's fee_summary by_class breakdown.
export const isLeftStatus = (status) => !!status && status !== 'ACTIVE' && status !== 'REPEAT'
