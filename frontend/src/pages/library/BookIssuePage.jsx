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

export default function BookIssuePage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [activeTab, setActiveTab] = useState('issue')

  // --- Issue Tab State ---
  const [issueForm, setIssueForm] = useState({
    borrower_type: 'STUDENT',
    borrower_id: '',
    book_id: '',
    due_date: (() => {
      const d = new Date()
      d.setDate(d.getDate() + 14)
      return d.toISOString().split('T')[0]
    })(),
    notes: '',
  })

  const [borrowerSearch, setBorrowerSearch] = useState('')
  const [bookSearch, setBookSearch] = useState('')

  // --- Return Tab State ---
  const [returnSearch, setReturnSearch] = useState('')
  const [returnConfirm, setReturnConfirm] = useState(null)

  // ---- Queries ----

  // Search borrowers (students or staff)
  const { data: borrowerResults } = useQuery({
    queryKey: ['borrowerSearch', issueForm.borrower_type, borrowerSearch],
    queryFn: () => {
      if (issueForm.borrower_type === 'STUDENT') {
        return libraryApi.searchStudents({ search: borrowerSearch })
      }
      return libraryApi.searchStaff({ search: borrowerSearch })
    },
    enabled: borrowerSearch.length >= 2,
  })

  // Search books for issue
  const { data: bookResults } = useQuery({
    queryKey: ['bookSearch', bookSearch],
    queryFn: () => libraryApi.getBooks({ search: bookSearch }),
    enabled: bookSearch.length >= 2,
  })

  // Active issues list (ISSUED status)
  const { data: activeIssuesData, isLoading: issuesLoading } = useQuery({
    queryKey: ['libraryIssues', 'active'],
    queryFn: () => libraryApi.getIssues({ status: 'ISSUED', page_size: 9999 }),
  })

  // Filtered issues for return tab
  const { data: returnIssuesData, isLoading: returnLoading } = useQuery({
    queryKey: ['libraryIssues', 'return', returnSearch],
    queryFn: () => libraryApi.getIssues({ status: 'ISSUED', search: returnSearch || undefined, page_size: 9999 }),
    enabled: activeTab === 'return',
  })

  const borrowers = borrowerResults?.data?.results || borrowerResults?.data || []
  const availableBooks = (bookResults?.data?.results || bookResults?.data || []).filter(
    (b) => (b.available_copies ?? (b.total_copies - (b.issued_copies || 0))) > 0
  )
  const activeIssues = activeIssuesData?.data?.results || activeIssuesData?.data || []
  const returnIssues = returnIssuesData?.data?.results || returnIssuesData?.data || []

  // ---- Mutations ----

  const issueMutation = useMutation({
    mutationFn: (data) => libraryApi.createIssue(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['libraryIssues'] })
      queryClient.invalidateQueries({ queryKey: ['libraryBooks'] })
      queryClient.invalidateQueries({ queryKey: ['libraryStats'] })
      setIssueForm({
        borrower_type: issueForm.borrower_type,
        borrower_id: '',
        book_id: '',
        due_date: (() => {
          const d = new Date()
          d.setDate(d.getDate() + 14)
          return d.toISOString().split('T')[0]
        })(),
        notes: '',
      })
      setBorrowerSearch('')
      setBookSearch('')
    },
  })

  const returnMutation = useMutation({
    mutationFn: ({ id, data }) => libraryApi.returnBook(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['libraryIssues'] })
      queryClient.invalidateQueries({ queryKey: ['libraryBooks'] })
      queryClient.invalidateQueries({ queryKey: ['libraryStats'] })
      queryClient.invalidateQueries({ queryKey: ['libraryOverdue'] })
      setReturnConfirm(null)
    },
  })

  // ---- Handlers ----

  const handleIssueSubmit = (e) => {
    e.preventDefault()
    issueMutation.mutate({
      book: parseInt(issueForm.book_id),
      borrower_type: issueForm.borrower_type,
      borrower_id: parseInt(issueForm.borrower_id),
      due_date: issueForm.due_date,
      notes: issueForm.notes,
    })
  }

  const handleReturn = (issue) => {
    setReturnConfirm(issue)
  }

  const confirmReturn = () => {
    if (!returnConfirm) return
    returnMutation.mutate({ id: returnConfirm.id, data: {} })
  }

  const selectBorrower = (b) => {
    setIssueForm({ ...issueForm, borrower_id: String(b.id) })
    setBorrowerSearch(b.name || b.full_name || `${b.first_name || ''} ${b.last_name || ''}`.trim())
  }

  const selectBook = (book) => {
    setIssueForm({ ...issueForm, book_id: String(book.id) })
    setBookSearch(book.title)
  }

  const tabs = [
    { key: 'issue', label: 'Issue Book' },
    { key: 'return', label: 'Return Book' },
  ]

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Issue / Return Books</h1>
        <p className="text-sm sm:text-base text-gray-600">Issue books to borrowers and process returns</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ============ ISSUE TAB ============ */}
      {activeTab === 'issue' && (
        <div className="space-y-6">
          {/* Issue Form */}
          <div className="bg-white rounded-lg shadow-sm p-5">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Issue a Book</h3>

            {issueMutation.error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {issueMutation.error.response?.data?.detail ||
                 issueMutation.error.response?.data?.non_field_errors?.[0] ||
                 issueMutation.error.message || 'Failed to issue book.'}
              </div>
            )}

            {issueMutation.isSuccess && (
              <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                Book issued successfully!
              </div>
            )}

            <form onSubmit={handleIssueSubmit} className="space-y-4">
              {/* Borrower Type */}
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-2">Borrower Type *</label>
                <div className="flex gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="btype"
                      value="STUDENT"
                      checked={issueForm.borrower_type === 'STUDENT'}
                      onChange={(e) => {
                        setIssueForm({ ...issueForm, borrower_type: e.target.value, borrower_id: '' })
                        setBorrowerSearch('')
                      }}
                      className="text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">Student</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="btype"
                      value="STAFF"
                      checked={issueForm.borrower_type === 'STAFF'}
                      onChange={(e) => {
                        setIssueForm({ ...issueForm, borrower_type: e.target.value, borrower_id: '' })
                        setBorrowerSearch('')
                      }}
                      className="text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">Staff</span>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Borrower Search */}
                <div className="relative">
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">
                    {issueForm.borrower_type === 'STUDENT' ? 'Student' : 'Staff Member'} *
                  </label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder={`Search ${issueForm.borrower_type === 'STUDENT' ? 'student' : 'staff'} by name...`}
                    value={borrowerSearch}
                    onChange={(e) => {
                      setBorrowerSearch(e.target.value)
                      if (!e.target.value) setIssueForm({ ...issueForm, borrower_id: '' })
                    }}
                  />
                  {borrowerSearch.length >= 2 && borrowers.length > 0 && !issueForm.borrower_id && (
                    <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {borrowers.map((b) => {
                        const displayName = b.name || b.full_name || `${b.first_name || ''} ${b.last_name || ''}`.trim()
                        const sub = issueForm.borrower_type === 'STUDENT'
                          ? `Roll #${b.roll_number || ''} - ${b.class_name || ''}`
                          : (b.designation_name || b.department_name || '')
                        return (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => selectBorrower(b)}
                            className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm"
                          >
                            <p className="font-medium text-gray-900">{displayName}</p>
                            {sub && <p className="text-xs text-gray-500">{sub}</p>}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {issueForm.borrower_id && (
                    <p className="text-xs text-green-600 mt-1">Selected ID: {issueForm.borrower_id}</p>
                  )}
                </div>

                {/* Book Search */}
                <div className="relative">
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Book *</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Search book by title..."
                    value={bookSearch}
                    onChange={(e) => {
                      setBookSearch(e.target.value)
                      if (!e.target.value) setIssueForm({ ...issueForm, book_id: '' })
                    }}
                  />
                  {bookSearch.length >= 2 && availableBooks.length > 0 && !issueForm.book_id && (
                    <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {availableBooks.map((book) => (
                        <button
                          key={book.id}
                          type="button"
                          onClick={() => selectBook(book)}
                          className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm"
                        >
                          <p className="font-medium text-gray-900">{book.title}</p>
                          <p className="text-xs text-gray-500">
                            {book.author}{book.isbn ? ` | ISBN: ${book.isbn}` : ''} |
                            Available: {book.available_copies ?? (book.total_copies - (book.issued_copies || 0))}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                  {issueForm.book_id && (
                    <p className="text-xs text-green-600 mt-1">Selected ID: {issueForm.book_id}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Due Date *</label>
                  <input
                    type="date"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={issueForm.due_date}
                    onChange={(e) => setIssueForm({ ...issueForm, due_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Notes</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Optional notes..."
                    value={issueForm.notes}
                    onChange={(e) => setIssueForm({ ...issueForm, notes: e.target.value })}
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={issueMutation.isPending || !issueForm.borrower_id || !issueForm.book_id}
                  className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {issueMutation.isPending ? 'Issuing...' : 'Issue Book'}
                </button>
              </div>
            </form>
          </div>

          {/* Active Issues Table */}
          <div className="bg-white rounded-lg shadow-sm">
            <div className="px-5 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Currently Issued Books</h3>
              <p className="text-sm text-gray-500">All active book issues</p>
            </div>
            {issuesLoading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                <p className="text-gray-500 mt-3">Loading issues...</p>
              </div>
            ) : activeIssues.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <svg className="w-10 h-10 mx-auto mb-2 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-sm">No books are currently issued.</p>
              </div>
            ) : (
              <>
                {/* Mobile card view */}
                <div className="sm:hidden divide-y divide-gray-200">
                  {activeIssues.map((issue) => {
                    const days = getDaysOverdue(issue.due_date)
                    return (
                      <div key={issue.id} className="p-4">
                        <div className="flex items-start justify-between mb-1">
                          <p className="font-medium text-sm text-gray-900">{issue.book_title || issue.book?.title || '-'}</p>
                          {days > 0 && (
                            <span className="flex-shrink-0 ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                              {days}d overdue
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">
                          {issue.borrower_name || '-'} ({issue.borrower_type})
                        </p>
                        <p className="text-xs text-gray-500">
                          Issued: {formatDate(issue.issue_date)} | Due: {formatDate(issue.due_date)}
                        </p>
                        <div className="mt-2 pt-2 border-t border-gray-100">
                          <button onClick={() => handleReturn(issue)} className="text-xs text-blue-600 font-medium">
                            Return
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
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Issue Date</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Due Date</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Overdue</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {activeIssues.map((issue) => {
                        const days = getDaysOverdue(issue.due_date)
                        return (
                          <tr key={issue.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">
                              {issue.book_title || issue.book?.title || '-'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">
                              {issue.borrower_name || '-'}
                            </td>
                            <td className="px-4 py-3">
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
                              {days > 0 ? (
                                <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                                  {days} days
                                </span>
                              ) : (
                                <span className="text-xs text-gray-400">-</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => handleReturn(issue)}
                                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                              >
                                Return
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
        </div>
      )}

      {/* ============ RETURN TAB ============ */}
      {activeTab === 'return' && (
        <div className="space-y-6">
          {/* Return Search */}
          <div className="bg-white rounded-lg shadow-sm p-5">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Search Issued Books</h3>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Search by student name, staff name, or book title..."
              value={returnSearch}
              onChange={(e) => setReturnSearch(e.target.value)}
            />
          </div>

          {/* Return Results */}
          <div className="bg-white rounded-lg shadow-sm">
            <div className="px-5 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Issued Books</h3>
              <p className="text-sm text-gray-500">Select a book to process the return</p>
            </div>

            {returnLoading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                <p className="text-gray-500 mt-3">Searching...</p>
              </div>
            ) : returnIssues.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <svg className="w-10 h-10 mx-auto mb-2 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <p className="text-sm">
                  {returnSearch ? 'No issued books match your search.' : 'No books are currently issued.'}
                </p>
              </div>
            ) : (
              <>
                {/* Mobile card view */}
                <div className="sm:hidden divide-y divide-gray-200">
                  {returnIssues.map((issue) => {
                    const days = getDaysOverdue(issue.due_date)
                    const fineAmount = issue.fine_amount || (days > 0 ? days * (issue.fine_per_day || 0) : 0)
                    return (
                      <div key={issue.id} className="p-4">
                        <div className="flex items-start justify-between mb-1">
                          <p className="font-medium text-sm text-gray-900">{issue.book_title || issue.book?.title || '-'}</p>
                          {days > 0 && (
                            <span className="flex-shrink-0 ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                              {days}d overdue
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">
                          {issue.borrower_name || '-'} ({issue.borrower_type})
                        </p>
                        <p className="text-xs text-gray-500">
                          Issued: {formatDate(issue.issue_date)} | Due: {formatDate(issue.due_date)}
                        </p>
                        {fineAmount > 0 && (
                          <p className="text-xs text-red-600 font-medium mt-1">Fine: Rs. {fineAmount}</p>
                        )}
                        <div className="mt-2 pt-2 border-t border-gray-100">
                          <button onClick={() => handleReturn(issue)} className="text-xs text-blue-600 font-medium">
                            Process Return
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
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Issue Date</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Due Date</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Days Overdue</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Fine</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {returnIssues.map((issue) => {
                        const days = getDaysOverdue(issue.due_date)
                        const fineAmount = issue.fine_amount || (days > 0 ? days * (issue.fine_per_day || 0) : 0)
                        return (
                          <tr key={issue.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">
                              {issue.book_title || issue.book?.title || '-'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">
                              <span>{issue.borrower_name || '-'}</span>
                              <span className={`ml-2 inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${
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
                              {days > 0 ? (
                                <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                                  {days} days
                                </span>
                              ) : (
                                <span className="text-xs text-gray-400">-</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-center text-sm">
                              {fineAmount > 0 ? (
                                <span className="font-medium text-red-600">Rs. {fineAmount}</span>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => handleReturn(issue)}
                                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                              >
                                Return
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
        </div>
      )}

      {/* ============ Return Confirmation Modal ============ */}
      {returnConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Confirm Return</h2>

            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Book:</span>
                <span className="font-medium text-gray-900">{returnConfirm.book_title || returnConfirm.book?.title || '-'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Borrower:</span>
                <span className="font-medium text-gray-900">{returnConfirm.borrower_name || '-'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Due Date:</span>
                <span className="font-medium text-gray-900">{formatDate(returnConfirm.due_date)}</span>
              </div>
              {getDaysOverdue(returnConfirm.due_date) > 0 && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Days Overdue:</span>
                    <span className="font-semibold text-red-600">{getDaysOverdue(returnConfirm.due_date)} days</span>
                  </div>
                  {(returnConfirm.fine_amount || returnConfirm.fine_per_day) && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Estimated Fine:</span>
                      <span className="font-semibold text-red-600">
                        Rs. {returnConfirm.fine_amount || (getDaysOverdue(returnConfirm.due_date) * (returnConfirm.fine_per_day || 0))}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>

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
                {returnMutation.isPending ? 'Processing...' : 'Confirm Return'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
