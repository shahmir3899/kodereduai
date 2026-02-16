import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { libraryApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'

function getDaysOverdue(dueDateStr) {
  if (!dueDateStr) return 0
  const due = new Date(dueDateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  due.setHours(0, 0, 0, 0)
  const diff = Math.floor((today - due) / (1000 * 60 * 60 * 24))
  return diff > 0 ? diff : 0
}

function formatDate(dateStr) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

export default function OverdueBooksPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [returnConfirm, setReturnConfirm] = useState(null)

  // ---- Queries ----

  const { data: overdueData, isLoading, error } = useQuery({
    queryKey: ['libraryOverdue'],
    queryFn: () => libraryApi.getOverdueBooks({ page_size: 9999 }),
  })

  const { data: configData } = useQuery({
    queryKey: ['libraryConfig'],
    queryFn: () => libraryApi.getFineConfig(),
  })

  const overdueBooks = overdueData?.data?.results || overdueData?.data || []
  const finePerDay = configData?.data?.fine_per_day || 0

  // Compute summary stats
  const totalOverdue = overdueBooks.length
  const totalEstimatedFines = overdueBooks.reduce((sum, issue) => {
    const days = getDaysOverdue(issue.due_date)
    const fine = issue.fine_amount || (days * (issue.fine_per_day || finePerDay))
    return sum + fine
  }, 0)

  // ---- Mutations ----

  const returnMutation = useMutation({
    mutationFn: ({ id, data }) => libraryApi.returnBook(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['libraryOverdue'] })
      queryClient.invalidateQueries({ queryKey: ['libraryIssues'] })
      queryClient.invalidateQueries({ queryKey: ['libraryBooks'] })
      queryClient.invalidateQueries({ queryKey: ['libraryStats'] })
      setReturnConfirm(null)
    },
  })

  const handleReturn = (issue) => {
    setReturnConfirm(issue)
  }

  const confirmReturn = () => {
    if (!returnConfirm) return
    returnMutation.mutate({ id: returnConfirm.id, data: {} })
  }

  // ---- Loading State ----
  if (isLoading) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Overdue Books</h1>
          <p className="text-sm sm:text-base text-gray-600">Track overdue books and manage fines</p>
        </div>
        <div className="text-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-gray-500 mt-3">Loading overdue books...</p>
        </div>
      </div>
    )
  }

  // ---- Error State ----
  if (error) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Overdue Books</h1>
          <p className="text-sm sm:text-base text-gray-600">Track overdue books and manage fines</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-6 text-center">
          <svg className="w-12 h-12 text-red-400 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <p className="text-red-600 font-medium">Failed to load overdue books.</p>
          <p className="text-gray-500 text-sm mt-1">{error.message || 'Please try again later.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Overdue Books</h1>
        <p className="text-sm sm:text-base text-gray-600">Track overdue books and manage fines</p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow-sm p-5">
          <div className="flex items-center gap-3">
            <div className="bg-red-50 p-2 rounded-lg">
              <svg className="w-7 h-7 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{totalOverdue}</p>
              <p className="text-xs font-medium text-gray-500 uppercase">Total Overdue</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-5">
          <div className="flex items-center gap-3">
            <div className="bg-amber-50 p-2 rounded-lg">
              <svg className="w-7 h-7 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">
                Rs. {totalEstimatedFines.toLocaleString()}
              </p>
              <p className="text-xs font-medium text-gray-500 uppercase">Total Estimated Fines</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-5">
          <div className="flex items-center gap-3">
            <div className="bg-blue-50 p-2 rounded-lg">
              <svg className="w-7 h-7 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">
                Rs. {finePerDay}
              </p>
              <p className="text-xs font-medium text-gray-500 uppercase">Fine Per Day</p>
            </div>
          </div>
        </div>
      </div>

      {/* Overdue Books Table */}
      <div className="bg-white rounded-lg shadow-sm">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Overdue Book List</h3>
          <p className="text-sm text-gray-500">Books past their due date that have not been returned</p>
        </div>

        {overdueBooks.length === 0 ? (
          <div className="text-center py-16">
            <svg className="w-12 h-12 text-green-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-gray-500 font-medium">No overdue books!</p>
            <p className="text-gray-400 text-sm mt-1">All issued books are within their due dates.</p>
          </div>
        ) : (
          <>
            {/* Mobile card view */}
            <div className="sm:hidden divide-y divide-gray-200">
              {overdueBooks.map((issue) => {
                const days = getDaysOverdue(issue.due_date)
                const fine = issue.fine_amount || (days * (issue.fine_per_day || finePerDay))
                return (
                  <div key={issue.id} className="p-4">
                    <div className="flex items-start justify-between mb-1">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm text-gray-900 truncate">
                          {issue.book_title || issue.book?.title || '-'}
                        </p>
                        <p className="text-xs text-gray-500">
                          {issue.borrower_name || '-'}
                          <span className={`ml-1.5 inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${
                            issue.borrower_type === 'STUDENT'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-purple-100 text-purple-700'
                          }`}>
                            {issue.borrower_type}
                          </span>
                        </p>
                      </div>
                      <span className="flex-shrink-0 ml-2 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                        {days}d overdue
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      <p>Issued: {formatDate(issue.issue_date)} | Due: {formatDate(issue.due_date)}</p>
                    </div>
                    {fine > 0 && (
                      <p className="text-xs text-red-600 font-medium mt-1">Fine: Rs. {fine}</p>
                    )}
                    <div className="flex gap-3 mt-2 pt-2 border-t border-gray-100">
                      <button
                        onClick={() => handleReturn(issue)}
                        className="text-xs text-blue-600 font-medium"
                      >
                        Return with Fine
                      </button>
                      <button
                        onClick={() => {/* Placeholder for send reminder */}}
                        className="text-xs text-gray-500 font-medium"
                        title="Send reminder (coming soon)"
                      >
                        Send Reminder
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Book Title</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Borrower</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Issue Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Due Date</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Days Overdue</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Est. Fine</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {overdueBooks.map((issue) => {
                    const days = getDaysOverdue(issue.due_date)
                    const fine = issue.fine_amount || (days * (issue.fine_per_day || finePerDay))
                    return (
                      <tr key={issue.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">
                          {issue.book_title || issue.book?.title || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {issue.borrower_name || '-'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            issue.borrower_type === 'STUDENT'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-purple-100 text-purple-700'
                          }`}>
                            {issue.borrower_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">{formatDate(issue.issue_date)}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{formatDate(issue.due_date)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                            days > 14
                              ? 'bg-red-200 text-red-800'
                              : days > 7
                                ? 'bg-red-100 text-red-700'
                                : 'bg-amber-100 text-amber-700'
                          }`}>
                            {days} days
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center text-sm font-medium text-red-600">
                          {fine > 0 ? `Rs. ${fine}` : '-'}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button
                            onClick={() => handleReturn(issue)}
                            className="text-sm text-blue-600 hover:text-blue-800 font-medium mr-3"
                          >
                            Return
                          </button>
                          <button
                            onClick={() => {/* Placeholder for send reminder */}}
                            className="text-sm text-gray-500 hover:text-gray-700 font-medium"
                            title="Send reminder (coming soon)"
                          >
                            Remind
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ============ Return Confirmation Modal ============ */}
      {returnConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Return Overdue Book</h2>

            {(() => {
              const days = getDaysOverdue(returnConfirm.due_date)
              const fine = returnConfirm.fine_amount || (days * (returnConfirm.fine_per_day || finePerDay))
              return (
                <div className="space-y-2 mb-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Book:</span>
                    <span className="font-medium text-gray-900 text-right">
                      {returnConfirm.book_title || returnConfirm.book?.title || '-'}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Borrower:</span>
                    <span className="font-medium text-gray-900">{returnConfirm.borrower_name || '-'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Due Date:</span>
                    <span className="font-medium text-gray-900">{formatDate(returnConfirm.due_date)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Days Overdue:</span>
                    <span className="font-semibold text-red-600">{days} days</span>
                  </div>
                  {fine > 0 && (
                    <div className="flex justify-between text-sm pt-2 border-t border-gray-100">
                      <span className="text-gray-500">Fine Amount:</span>
                      <span className="font-bold text-red-600 text-lg">Rs. {fine}</span>
                    </div>
                  )}
                </div>
              )
            })()}

            {returnMutation.error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {returnMutation.error.response?.data?.detail || returnMutation.error.message || 'Failed to process return.'}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setReturnConfirm(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmReturn}
                disabled={returnMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {returnMutation.isPending ? 'Processing...' : 'Return with Fine'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
