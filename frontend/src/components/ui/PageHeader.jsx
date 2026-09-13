/**
 * Shared page title block. Standardizes on text-2xl font-bold (the majority
 * convention already in use) — page titles had drifted between text-xl,
 * text-2xl and text-3xl with no consistent rule.
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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
