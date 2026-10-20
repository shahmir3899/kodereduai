import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from '../../../test/utils'
import { useFeeCollection } from '../useFeeCollection'

const showSuccess = vi.fn()

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeSchool: { id: 1 }, effectiveRole: 'SCHOOL_ADMIN' }),
}))
vi.mock('../../../contexts/BackgroundTaskContext', () => ({
  useBackgroundTasks: () => ({ addTask: vi.fn(), tasks: [] }),
}))
vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showSuccess, showError: vi.fn(), showWarning: vi.fn(), addToast: vi.fn() }),
}))

const createWrapper = () => {
  const client = createTestQueryClient()
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const hookArgs = { month: 10, year: 2026, classFilter: '', statusFilter: '', feeTypeFilter: 'MONTHLY', academicYearId: 1 }

describe('bulk fee actions give success feedback', () => {
  beforeEach(() => {
    showSuccess.mockClear()
    server.use(http.post('/api/finance/fee-payments/bulk_update/', () => HttpResponse.json({ updated: 3 })))
  })

  it('Pay Full announces how many records were marked fully paid', async () => {
    const { result } = renderHook(() => useFeeCollection(hookArgs), { wrapper: createWrapper() })
    await act(async () => { await result.current.bulkUpdateMutation.mutateAsync({ pay_full: true, ids: [1, 2, 3], account: 1, payment_method: 'CASH' }) })
    await waitFor(() => expect(showSuccess).toHaveBeenCalledWith('3 fee records marked as fully paid'))
  })

  it('Update announces how many records were updated (singular for one)', async () => {
    const { result } = renderHook(() => useFeeCollection(hookArgs), { wrapper: createWrapper() })
    await act(async () => { await result.current.bulkUpdateMutation.mutateAsync({ records: [{ id: 1, amount_paid: 500 }] }) })
    await waitFor(() => expect(showSuccess).toHaveBeenCalledWith('1 fee record updated'))
  })
})
