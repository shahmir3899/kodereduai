/**
 * Shared page title block. Standardizes on text-xl sm:text-2xl font-bold (what
 * ~100 pages already used) — page titles had drifted between text-xl, text-2xl
 * and text-3xl with no consistent rule. Smaller on phones so long titles
 * don't wrap onto three lines next to the actions.
 *
 * Usage:
 *   <PageHeader title="Staff Directory" />
 *   <PageHeader
 *     title="Staff Directory"
 *     subtitle="Manage employee records across all departments"
 *     actions={<Button onClick={openAddStaff}>Add Staff</Button>}
 *   />
 */

export default function PageHeader({ title, subtitle, actions, className = '' }) {
  return (
    <div className={`flex items-start justify-between gap-4 flex-wrap ${className}`}>
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">{title}</h1>
        {subtitle && <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
