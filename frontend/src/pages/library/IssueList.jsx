import Badge from '../../components/ui/Badge'
import { RecordCard, CardGrid, ViewToggle } from '../../components/cards'
import { formatDate, rupees } from './libraryUtils'

// One list for "Currently Issued", the Return tab and the Overdue page: they differ only in
// the action offered and whether a fine column is worth showing.
export function IssueStatus({ issue }) {
  if (issue.days_overdue > 0) return <Badge tone="danger">{issue.days_overdue}d overdue</Badge>
  return <Badge tone="info">Issued</Badge>
}

function BorrowerType({ type }) {
  return <Badge tone={type === 'STUDENT' ? 'info' : 'accent'} className="ml-2 !px-1.5">{type === 'STUDENT' ? 'Student' : 'Staff'}</Badge>
}

export default function IssueList({ issues, view, onViewChange, actionLabel, onAction, showFine = false }) {
  const hasFine = (i) => Number(i.estimated_fine) > 0

  return (
    <>
      <div className="flex justify-end p-2">
        <ViewToggle view={view} onChange={onViewChange} />
      </div>

      {view === 'cards' ? (
        <CardGrid className="p-2">
          {issues.map((issue) => (
            <RecordCard
              key={issue.id}
              title={issue.book_title || '-'}
              meta={`${issue.borrower_name || '-'} (${issue.borrower_type === 'STUDENT' ? 'Student' : 'Staff'})`}
              status={<IssueStatus issue={issue} />}
              fields={[
                { label: 'Issued', value: formatDate(issue.issue_date) },
                { label: 'Due', value: formatDate(issue.due_date) },
                ...(showFine && hasFine(issue) ? [{ label: 'Fine', value: rupees(issue.estimated_fine) }] : []),
              ]}
              actions={onAction ? [{ label: actionLabel, tone: 'info', onClick: () => onAction(issue) }] : []}
            />
          ))}
        </CardGrid>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Book Title', 'Borrower', 'Issue Date', 'Due Date', 'Status'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                ))}
                {showFine && <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Est. Fine</th>}
                {onAction && <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {issues.map((issue) => (
                <tr key={issue.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{issue.book_title || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {issue.borrower_name || '-'}<BorrowerType type={issue.borrower_type} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{formatDate(issue.issue_date)}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{formatDate(issue.due_date)}</td>
                  <td className="px-4 py-3"><IssueStatus issue={issue} /></td>
                  {showFine && (
                    <td className="px-4 py-3 text-center text-sm">
                      {hasFine(issue)
                        ? <span className="font-medium text-red-600">{rupees(issue.estimated_fine)}</span>
                        : <span className="text-gray-400">-</span>}
                    </td>
                  )}
                  {onAction && (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => onAction(issue)} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
                        {actionLabel}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// Confirm dialog body shared by the Issue page and the Overdue page.
export function ReturnSummary({ issue }) {
  const rows = [
    ['Book', issue.book_title || '-'],
    ['Borrower', issue.borrower_name || '-'],
    ['Due Date', formatDate(issue.due_date)],
  ]
  return (
    <div className="space-y-2 mb-4">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between text-sm">
          <span className="text-gray-500">{k}:</span>
          <span className="font-medium text-gray-900">{v}</span>
        </div>
      ))}
      {issue.days_overdue > 0 && (
        <>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Days Overdue:</span>
            <span className="font-semibold text-red-600">{issue.days_overdue} days</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Fine:</span>
            <span className="font-semibold text-red-600">{rupees(issue.estimated_fine)}</span>
          </div>
        </>
      )}
    </div>
  )
}
