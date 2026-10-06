import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const auth = { user: { schools: [{ id: 1 }] }, isStaffMember: false }
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../../contexts/AcademicYearContext', () => ({ useAcademicYear: () => ({ activeAcademicYear: { id: 7 } }) }))

const getMonthlySummary = vi.fn()
const getMonthlySummaryAll = vi.fn()
vi.mock('../../services/api', () => ({
  financeApi: {
    getMonthlySummary: (...a) => getMonthlySummary(...a),
    getMonthlySummaryAll: (...a) => getMonthlySummaryAll(...a),
  },
}))

import { useAnnualFeeSummary, useFeeMonthSummary } from '../useFeeMonthSummary'

const wrapper = ({ children }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
)

const body = { total_due: '1000', total_collected: '500', total_pending: '500', by_type: [] }

describe('useFeeMonthSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getMonthlySummary.mockResolvedValue({ data: body })
    getMonthlySummaryAll.mockResolvedValue({ data: { schools: [], grand: body } })
  })

  it('uses the single-school endpoint with the active academic year', async () => {
    auth.user = { schools: [{ id: 1 }] }
    const { result } = renderHook(() => useFeeMonthSummary(), { wrapper })
    await waitFor(() => expect(result.current.summary).not.toBeNull())
    expect(getMonthlySummary).toHaveBeenCalledWith(expect.objectContaining({ academic_year: 7, fee_type: 'MONTHLY' }))
    expect(getMonthlySummaryAll).not.toHaveBeenCalled()
    expect(result.current.summary.rate).toBe(50)
  })

  it('uses the all-schools endpoint for an admin with several schools', async () => {
    auth.user = { schools: [{ id: 1 }, { id: 2 }] }
    const { result } = renderHook(() => useFeeMonthSummary(), { wrapper })
    await waitFor(() => expect(result.current.summary).not.toBeNull())
    expect(getMonthlySummaryAll).toHaveBeenCalledWith(expect.objectContaining({ fee_type: 'MONTHLY' }))
    expect(getMonthlySummary).not.toHaveBeenCalled()
    expect(result.current.isMulti).toBe(true)
  })

  it('does not fetch while disabled', () => {
    renderHook(() => useFeeMonthSummary({ enabled: false }), { wrapper })
    expect(getMonthlySummary).not.toHaveBeenCalled()
  })

  it('asks for ANNUAL fees with month=0, across all schools for a multi-school admin', async () => {
    auth.user = { schools: [{ id: 1 }, { id: 2 }] }
    const { result } = renderHook(() => useAnnualFeeSummary(), { wrapper })
    await waitFor(() => expect(result.current.summary).not.toBeNull())
    expect(getMonthlySummaryAll).toHaveBeenCalledWith(expect.objectContaining({ month: 0, fee_type: 'ANNUAL' }))
  })
})
