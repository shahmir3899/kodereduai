import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import PageHeader from '../../components/ui/PageHeader'
import LoadingState from '../../components/ui/LoadingState'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'
import { libraryApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { getErrorMessage } from '../../utils/errorUtils'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useViewPreference } from '../../hooks/useViewPreference'
import IssueList, { ReturnSummary } from './IssueList'
import { canManageLibrary, listOf, rupees } from './libraryUtils'

export default function OverdueBooksPage() {
  const { effectiveRole } = useAuth()
  // Returning and the fine-per-day setting are admin-only in the API; everyone else just reads the list.
  const canManage = canManageLibrary(effectiveRole)
  const queryClient = useQueryClient()
  const toast = useToast()

  const [view, setView] = useViewPreference('overdue-books')
  const [returnConfirm, setReturnConfirm] = useState(null)
  useEscapeKey(() => setReturnConfirm(null), !!returnConfirm)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['libraryOverdue'],
    queryFn: () => libraryApi.getOverdueBooks(),
  })

  const { data: configRes } = useQuery({
    queryKey: ['libraryConfig'],
    queryFn: () => libraryApi.getFineConfig(),
    enabled: canManage,
  })

  const overdueBooks = listOf(data)
  const finePerDay = configRes?.data?.fine_per_day || 0
  const totalFines = overdueBooks.reduce((sum, i) => sum + Number(i.estimated_fine || 0), 0)

  const returnMutation = useMutation({
    mutationFn: (id) => libraryApi.returnBook(id, {}),
    onSuccess: (res) => {
      ;['libraryOverdue', 'libraryIssues', 'libraryBooks', 'bookSearch', 'libraryStats']
        .forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }))
      const fine = Number(res.data.fine_amount)
      toast.showSuccess(fine > 0 ? `Book returned. Fine: ${rupees(fine)}` : 'Book returned')
      setReturnConfirm(null)
    },
    onError: (err) => toast.showError(getErrorMessage(err, 'Failed to process the return.')),
  })

  const summary = [
    { label: 'Total Overdue', value: overdueBooks.length },
    { label: 'Total Estimated Fines', value: rupees(totalFines) },
    ...(canManage ? [{ label: 'Fine Per Day', value: rupees(finePerDay) }] : []),
  ]

  return (
    <div>
      <PageHeader title="Overdue Books" subtitle="Track overdue books and the fines they have built up" className="mb-6" />

      {isLoading ? (
        <LoadingState label="Loading overdue books..." compact />
      ) : isError ? (
        <ErrorState message="Could not load the overdue books." onRetry={refetch} />
      ) : (
        <>
          <div className={`grid grid-cols-1 ${summary.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-4 mb-6`}>
            {summary.map((card) => (
              <div key={card.label} className="bg-white rounded-lg shadow-sm p-5">
                <p className="text-2xl font-bold text-gray-900">{card.value}</p>
                <p className="text-xs font-medium text-gray-500 uppercase">{card.label}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-lg shadow-sm">
            <div className="px-5 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Overdue Book List</h3>
              <p className="text-sm text-gray-500">Books past their due date that have not been returned</p>
            </div>
            {overdueBooks.length === 0 ? (
              <EmptyState title="No overdue books" description="All issued books are within their due dates." />
            ) : (
              <IssueList
                issues={overdueBooks}
                view={view}
                onViewChange={setView}
                actionLabel="Return"
                onAction={canManage ? setReturnConfirm : undefined}
                showFine
              />
            )}
          </div>
        </>
      )}

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
