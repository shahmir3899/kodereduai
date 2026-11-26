import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderWithProviders } from '../../../test/utils'
import { defaultDueDate } from '../VoucherModal'
import VoucherModal from '../VoucherModal'
import OptionalFeesTab from '../OptionalFeesTab'
import { useBackgroundTask } from '../../../hooks/useBackgroundTask'
import { financeApi } from '../../../services/api'

vi.mock('../../../services/api', () => ({
  financeApi: {
    getVoucherSettings: vi.fn(),
    updateVoucherSettings: vi.fn(),
    downloadFeeVouchers: vi.fn(),
    previewFeeVouchers: vi.fn(),
    getMonthlyCategories: vi.fn(),
    getAnnualCategories: vi.fn(),
    createMonthlyCategory: vi.fn(),
    createAnnualCategory: vi.fn(),
    getFeeEnrollments: vi.fn(),
  },
  studentsApi: { getStudents: vi.fn() },
  tasksApi: { getTask: vi.fn() },
}))
vi.mock('../../../contexts/BackgroundTaskContext', () => ({
  useBackgroundTasks: () => ({ addTask: vi.fn() }),
}))
vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ activeAcademicYear: { id: 1 } }),
}))
vi.mock('../../../hooks/useSessionClasses', () => ({
  useSessionClasses: () => ({ sessionClasses: [] }),
}))
vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn(), addToast: vi.fn(), showWarning: vi.fn() }),
}))
vi.mock('../../../utils/schoolTime', () => ({ schoolToday: () => '2026-11-26' }))

describe('defaultDueDate', () => {
  it('keeps the school due day while it is still ahead', () => {
    expect(defaultDueDate(2026, 12, 10, '2026-11-26')).toEqual({ date: '2026-12-10', late: false, usual: '2026-12-10' })
  })
  it('moves to a week from today once the due day has passed', () => {
    expect(defaultDueDate(2026, 11, 10, '2026-11-26')).toEqual({ date: '2026-12-03', late: true, usual: '2026-11-10' })
  })
})

describe('useBackgroundTask reset (generate dialog reopening bug)', () => {
  it('forgets the submitted task so a reopened dialog does not close itself', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useBackgroundTask({
      mutationFn: () => Promise.resolve({ data: { task_id: 't1', message: 'ok' } }), taskType: 'X', title: 'Gen',
    }), { wrapper })
    await act(() => result.current.mutateAsync())
    expect(result.current.submittedTaskId).toBe('t1')
    act(() => result.current.reset())
    expect(result.current.submittedTaskId).toBeNull()
  })
})

describe('VoucherModal due date and preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    financeApi.getVoucherSettings.mockResolvedValue({ data: { due_day: 10, voucher_bank_account_id: null, voucher_note: '', bank_accounts: [] } })
  })

  it('warns when the due day has passed and sends the moved date with the preview', async () => {
    financeApi.previewFeeVouchers.mockResolvedValue({ data: {
      count: 4, school_name: 'Alpha', bank: { bank_name: 'Demo Bank', account_number: '001' }, note: '',
      vouchers: [{ student_id: 1, student_name: 'Ali Hassan', class_label: 'Class 1 - A', voucher_number: '202611-1', month_label: 'November 2026',
        due_date: '2026-12-03', lines: [{ label: 'Koder Kids', amount: '1500' }], current_total: '1500', discount: '0', previous_unpaid: '3000', paid: '0', total_payable: '4500' }],
    } })
    renderWithProviders(<VoucherModal open onClose={vi.fn()} month={11} year={2026} studentIds={null} scopeParams={{}} scopeLabel="All" canEditSettings />)
    expect(await screen.findByText(/has passed, so these vouchers are due a week from today/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() => expect(financeApi.previewFeeVouchers).toHaveBeenCalledWith(expect.objectContaining({ due_date: '2026-12-03' })))
    expect(await screen.findByText('Ali Hassan')).toBeInTheDocument()
    expect(screen.getByText('4,500')).toBeInTheDocument()
  })
})

describe('OptionalFeesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    financeApi.getMonthlyCategories.mockResolvedValue({ data: [
      { id: 1, name: 'Tuition Fee', billing_mode: 'ALL' },
      { id: 4, name: 'Robotics', billing_mode: 'ENROLLED', default_amount: '1500.00', enrolled_count: 3 },
    ] })
    financeApi.getAnnualCategories.mockResolvedValue({ data: [] })
    financeApi.getFeeEnrollments.mockResolvedValue({ data: [] })
  })

  it('lists only optional fees with price and enrolled count', async () => {
    renderWithProviders(<OptionalFeesTab />)
    expect(await screen.findByText('Robotics')).toBeInTheDocument()
    expect(screen.getByText('Rs 1,500')).toBeInTheDocument()
    expect(screen.getByText('3 students')).toBeInTheDocument()
    expect(screen.queryByText('Tuition Fee')).not.toBeInTheDocument()
  })

  it('creates an enrolled-only fee and opens its students', async () => {
    financeApi.createMonthlyCategory.mockResolvedValue({ data: { id: 9, name: 'Koder Kids', billing_mode: 'ENROLLED', default_amount: '1500.00' } })
    renderWithProviders(<OptionalFeesTab />)
    fireEvent.change(await screen.findByPlaceholderText('e.g. Koder Kids'), { target: { value: 'Koder Kids' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. 1500'), { target: { value: '1500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create and enroll students' }))
    await waitFor(() => expect(financeApi.createMonthlyCategory).toHaveBeenCalledWith({ name: 'Koder Kids', billing_mode: 'ENROLLED', default_amount: '1500' }))
    expect(await screen.findByText('Koder Kids: who pays?')).toBeInTheDocument()
  })
})
