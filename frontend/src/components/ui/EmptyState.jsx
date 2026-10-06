/**
 * Shared "nothing here" block. Replaces the hand-written "No X found" strings
 * so every empty list says what is missing and, where possible, offers the next step.
 *
 * Usage:
 *   <EmptyState title="No students found" />
 *   <EmptyState
 *     title="No expenses yet"
 *     description="Expenses you record will appear here."
 *     action={<Button onClick={openAdd}>Add expense</Button>}
 *   />
 *   <EmptyState title="No results" description="Try a different search." compact />
 *
 * `icon` is optional (any node); omit it for plain-text empties inside tables/modals.
 */
export default function EmptyState({ title, description, icon, action, compact = false, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-6' : 'py-12'} ${className}`}>
      {icon && <div className="mb-3 text-gray-400 dark:text-gray-500">{icon}</div>}
      <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{title}</p>
      {description && <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
