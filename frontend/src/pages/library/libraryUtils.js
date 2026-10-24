// "Still out" = ISSUED or OVERDUE: the reminder job flips ISSUED to OVERDUE, and both
// states count against stock, borrower limits and the return lists.
export const OPEN_STATUS = 'ISSUED,OVERDUE'

// The API refuses every write from anyone but these roles, so write buttons are hidden for the rest.
const MANAGE_ROLES = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL']
export const canManageLibrary = (role) => MANAGE_ROLES.includes(role)

// Parsed by hand: new Date('2026-10-24') is UTC midnight and can show the day before.
export function formatDate(dateStr) {
  if (!dateStr) return '-'
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return dateStr
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

// Local date, not toISOString(): that is UTC and shifts the day late in the evening.
export function defaultDueDate(days = 14) {
  const d = new Date()
  d.setDate(d.getDate() + (Number(days) || 14))
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const borrowerName = (b) =>
  b.name || b.full_name || `${b.first_name || ''} ${b.last_name || ''}`.trim()

export const listOf = (res) => res?.data?.results || res?.data || []

export const rupees = (n) => `Rs. ${Number(n || 0).toLocaleString()}`
