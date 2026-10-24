import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import PageHeader from '../../components/ui/PageHeader'
import LoadingState from '../../components/ui/LoadingState'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'
import Field from '../../components/ui/Field'
import { libraryApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { getErrorMessage } from '../../utils/errorUtils'
import { useDebounce } from '../../hooks/useDebounce'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useViewPreference } from '../../hooks/useViewPreference'
import IssueFields, { issuePayload } from './IssueFields'
import IssueList, { ReturnSummary } from './IssueList'
import { OPEN_STATUS, canManageLibrary, defaultDueDate, listOf } from './libraryUtils'

const newForm = (loanDays, borrowerType = 'STUDENT') => ({
  borrower_type: borrowerType,
  borrower: null,
  book: null,
  due_date: defaultDueDate(loanDays),
  notes: '',
  borrowerQuery: '',
  bookQuery: '',
})

export default function BookIssuePage() {
  const { effectiveRole } = useAuth()
  const canManage = canManageLibrary(effectiveRole)
  const queryClient = useQueryClient()
  const toast = useToast()

  const [activeTab, setActiveTab] = useState(canManage ? 'issue' : 'return')
  const [activeView, setActiveView] = useViewPreference('book-issues-active')
  const [returnView, setReturnView] = useViewPreference('book-issues-return')

  // The configured loan period sets the default due date (admins only: the endpoint is admin-only).
  const { data: configRes } = useQuery({
    queryKey: ['libraryConfig'],
    queryFn: () => libraryApi.getFineConfig(),
    enabled: canManage,
  })
  const loanDays = configRes?.data?.loan_period_days || 14

  const [form, setForm] = useState(() => newForm(14))
  // The config arrives after first paint; refresh the default so the form never shows a stale 14.
  useEffect(() => setForm((f) => ({ ...f, due_date: defaultDueDate(loanDays) })), [loanDays])
  const [returnSearch, setReturnSearch] = useState('')
  const debouncedReturnSearch = useDebounce(returnSearch, 300)
  const [returnConfirm, setReturnConfirm] = useState(null)
  useEscapeKey(() => setReturnConfirm(null), !!returnConfirm)

  // ---- Queries ----
  const { data: activeRes, isLoading: issuesLoading, isError: issuesError, refetch } = useQuery({
    queryKey: ['libraryIssues', 'active'],
    queryFn: () => libraryApi.getIssues({ status: OPEN_STATUS, page_size: 2000 }),
  })

  const { data: returnRes, isLoading: returnLoading } = useQuery({
    queryKey: ['libraryIssues', 'return', debouncedReturnSearch],
    queryFn: () => libraryApi.getIssues({ status: OPEN_STATUS, search: debouncedReturnSearch || undefined, page_size: 2000 }),
    enabled: activeTab === 'return',
  })

  const activeIssues = listOf(activeRes)
  const returnIssues = listOf(returnRes)

  const refreshAll = () => {
    ;['libraryIssues', 'libraryBooks', 'bookSearch', 'libraryStats', 'libraryOverdue']
      .forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }))
  }

  // ---- Mutations ----
  const issueMutation = useMutation({
    mutationFn: (data) => libraryApi.createIssue(data),
    onSuccess: (res) => {
      refreshAll()
      toast.showSuccess(`Issued "${res.data.book_title}" to ${res.data.borrower_name}`)
      setForm(newForm(loanDays, form.borrower_type))
    },
    onError: (err) => toast.showError(getErrorMessage(err, 'Failed to issue the book.')),
  })

  const returnMutation = useMutation({
    mutationFn: (id) => libraryApi.returnBook(id, {}),
    onSuccess: (res) => {
      refreshAll()
      const fine = Number(res.data.fine_amount)
      toast.showSuccess(fine > 0
        ? `Book returned. Fine: Rs. ${fine.toLocaleString()}`
        : 'Book returned')
      setReturnConfirm(null)
    },
    onError: (err) => toast.showError(getErrorMessage(err, 'Failed to process the return.')),
  })

  const handleIssueSubmit = (e) => {
    e.preventDefault()
    if (!form.borrower) return toast.showError(`Choose a ${form.borrower_type === 'STAFF' ? 'staff member' : 'student'}`)
    if (!form.book) return toast.showError('Choose a book')
    issueMutation.mutate(issuePayload(form))
  }

  const tabs = [
    ...(canManage ? [{ key: 'issue', label: 'Issue Book' }] : []),
    { key: 'return', label: canManage ? 'Return Book' : 'Issued Books' },
  ]
  const onReturn = canManage ? setReturnConfirm : undefined

  return (
    <div>
      <PageHeader
        title={canManage ? 'Issue / Return Books' : 'Issued Books'}
        subtitle={canManage ? 'Issue books to borrowers and process returns' : 'Books currently out of the library'}
        className="mb-6"
      />

      {tabs.length > 1 && (
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
      )}

      {/* ============ ISSUE TAB ============ */}
      {canManage && activeTab === 'issue' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm p-5">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Issue a Book</h3>
            <p className="text-sm text-gray-500 mb-4">
              Pick the borrower and the book, check the due date ({loanDays} days from today by default), then issue.
            </p>
            <form onSubmit={handleIssueSubmit} className="space-y-4">
              <IssueFields form={form} setForm={setForm} />
              <div className="pt-2">
                <Button type="submit" loading={issueMutation.isPending} disabled={issueMutation.isPending}>
                  Issue Book
                </Button>
              </div>
            </form>
          </div>

          <div className="bg-white rounded-lg shadow-sm">
            <div className="px-5 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Currently Issued Books</h3>
              <p className="text-sm text-gray-500">All books that are still out</p>
            </div>
            {issuesLoading ? (
              <LoadingState label="Loading issues..." compact />
            ) : issuesError ? (
              <ErrorState message="Could not load the issued books." onRetry={refetch} compact />
            ) : activeIssues.length === 0 ? (
              <EmptyState title="No books are currently issued" description="Issued books will appear here." />
            ) : (
              <IssueList
                issues={activeIssues}
                view={activeView}
                onViewChange={setActiveView}
                actionLabel="Return"
                onAction={onReturn}
              />
            )}
          </div>
        </div>
      )}

      {/* ============ RETURN TAB ============ */}
      {activeTab === 'return' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm p-5">
            <Field label="Search Issued Books">
              <input
                type="text"
                className="input"
                placeholder="Search by student name, staff name, or book title..."
                value={returnSearch}
                onChange={(e) => setReturnSearch(e.target.value)}
              />
            </Field>
          </div>

          <div className="bg-white rounded-lg shadow-sm">
            <div className="px-5 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Issued Books</h3>
              {canManage && <p className="text-sm text-gray-500">Select a book to process the return</p>}
            </div>
            {returnLoading ? (
              <LoadingState label="Searching..." compact />
            ) : returnIssues.length === 0 ? (
              <EmptyState
                title={returnSearch ? 'No issued books match your search' : 'No books are currently issued'}
                description={returnSearch ? 'Try a different name or title.' : undefined}
              />
            ) : (
              <IssueList
                issues={returnIssues}
                view={returnView}
                onViewChange={setReturnView}
                actionLabel="Process Return"
                onAction={onReturn}
                showFine
              />
            )}
          </div>
        </div>
      )}

      {/* ============ Return Confirmation Modal ============ */}
      {returnConfirm && (
        <Modal open size="sm" closeOnBackdrop={false}>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Confirm Return</h2>
          <ReturnSummary issue={returnConfirm} />
          {returnMutation.error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {getErrorMessage(returnMutation.error, 'Failed to process the return.')}
            </div>
          )}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setReturnConfirm(null)}>Cancel</Button>
            <Button onClick={() => returnMutation.mutate(returnConfirm.id)} loading={returnMutation.isPending}>
              Confirm Return
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
