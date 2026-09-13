import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { parentsApi } from '../../services/api'
import Spinner from '../../components/ui/Spinner'

const statusBadge = {
  ISSUED: 'bg-blue-100 text-blue-800',
  RETURNED: 'bg-green-100 text-green-800',
  OVERDUE: 'bg-red-100 text-red-800',
  LOST: 'bg-gray-100 text-gray-800',
}

export default function ChildLibrary() {
  const { studentId } = useParams()

  const { data, isLoading } = useQuery({
    queryKey: ['childLibrary', studentId],
    queryFn: () => parentsApi.getChildLibrary(studentId),
    enabled: !!studentId,
  })

  const issues = data?.data || []
  const current = issues.filter((i) => i.status === 'ISSUED' || i.status === 'OVERDUE')
  const past = issues.filter((i) => i.status === 'RETURNED' || i.status === 'LOST')

  return (
    <div className="space-y-6">
      <Link to={`/parent/children/${studentId}`} className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Overview
      </Link>

      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Library</h1>
        <p className="text-sm text-gray-500 mt-1">Books currently issued and past history</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size="md" />
        </div>
      ) : issues.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          No book issues on record.
        </div>
      ) : (
        <>
          {current.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Currently Issued</h2>
              <div className="space-y-2">
                {current.map((issue) => (
                  <div key={issue.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{issue.book_title}</p>
                      <p className="text-xs text-gray-500">{issue.book_author}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Issued {issue.issue_date} · Due {issue.due_date}
                        {Number(issue.fine_amount) > 0 && <span className="text-red-600"> · Fine: Rs. {issue.fine_amount}</span>}
                      </p>
                    </div>
                    <span className={`shrink-0 ml-3 px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge[issue.status] || 'bg-gray-100'}`}>
                      {issue.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {past.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Past History</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <th className="pb-2 pr-4">Book</th>
                      <th className="pb-2 pr-4">Issued</th>
                      <th className="pb-2 pr-4">Returned</th>
                      <th className="pb-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {past.map((issue) => (
                      <tr key={issue.id}>
                        <td className="py-2 pr-4">
                          <p className="font-medium text-gray-900">{issue.book_title}</p>
                          <p className="text-xs text-gray-500">{issue.book_author}</p>
                        </td>
                        <td className="py-2 pr-4 text-gray-600">{issue.issue_date}</td>
                        <td className="py-2 pr-4 text-gray-600">{issue.return_date || '—'}</td>
                        <td className="py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge[issue.status] || 'bg-gray-100'}`}>
                            {issue.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
