import { useQuery } from '@tanstack/react-query'
import { studentPortalApi } from '../../services/api'
import Spinner from '../../components/ui/Spinner'
import { RecordCard, CardGrid, ViewToggle } from '../../components/cards'
import { useViewPreference } from '../../hooks/useViewPreference'

const statusBadge = {
  ISSUED: 'bg-blue-100 text-blue-800',
  RETURNED: 'bg-green-100 text-green-800',
  OVERDUE: 'bg-red-100 text-red-800',
  LOST: 'bg-gray-100 text-gray-800',
}

export default function StudentLibrary() {
  const [view, setView] = useViewPreference('student-library-history')
  const { data, isLoading, error } = useQuery({
    queryKey: ['studentLibrary'],
    queryFn: () => studentPortalApi.getLibrary(),
  })

  const issues = data?.data || []
  const current = issues.filter((i) => i.status === 'ISSUED' || i.status === 'OVERDUE')
  const past = issues.filter((i) => i.status === 'RETURNED' || i.status === 'LOST')

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="md" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <h3 className="text-base font-medium text-red-900 mb-1">Failed to load library records</h3>
        <p className="text-sm text-red-600">{error.message || 'Please try again later.'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">My Library</h1>
        <p className="text-sm text-gray-500 mt-1">Books currently issued and past history</p>
      </div>

      {issues.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <svg className="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
          <h3 className="text-base font-medium text-gray-900 mb-1">No book issues on record</h3>
          <p className="text-sm text-gray-500">Books you borrow from the library will appear here.</p>
        </div>
      ) : (
        <>
          {current.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Currently Issued</h2>
              <CardGrid>
                {current.map((issue) => (
                  <RecordCard
                    key={issue.id}
                    title={issue.book_title}
                    meta={issue.book_author}
                    status={
                      <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${statusBadge[issue.status] || 'bg-gray-100'}`}>
                        {issue.status}
                      </span>
                    }
                    fields={[
                      { label: 'Issued', value: issue.issue_date },
                      { label: 'Due', value: issue.due_date },
                      ...(Number(issue.fine_amount) > 0 ? [{ label: 'Fine', value: <span className="text-red-600">PKR {issue.fine_amount}</span> }] : []),
                    ]}
                  />
                ))}
              </CardGrid>
            </div>
          )}

          {past.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 pt-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900 mb-3">Past History</h2>
                <ViewToggle view={view} onChange={setView} />
              </div>
              {view === 'cards' ? (
              <CardGrid className="p-4 pt-1">
                {past.map((issue) => (
                  <RecordCard
                    key={issue.id}
                    title={issue.book_title}
                    meta={issue.book_author}
                    status={
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${statusBadge[issue.status] || 'bg-gray-100'}`}>
                        {issue.status}
                      </span>
                    }
                    fields={[
                      { label: 'Issued', value: issue.issue_date },
                      { label: 'Returned', value: issue.return_date || '—' },
                    ]}
                  />
                ))}
              </CardGrid>
              ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Book</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Issued</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Returned</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {past.map((issue) => (
                      <tr key={issue.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-gray-900">{issue.book_title}</p>
                          <p className="text-xs text-gray-500">{issue.book_author}</p>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{issue.issue_date}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{issue.return_date || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge[issue.status] || 'bg-gray-100'}`}>
                            {issue.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
