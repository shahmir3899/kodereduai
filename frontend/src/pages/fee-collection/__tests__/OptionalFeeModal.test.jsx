import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../../test/utils'
import OptionalFeeModal from '../OptionalFeeModal'
import { financeApi, studentsApi } from '../../../services/api'

vi.mock('../../../services/api', () => ({
  financeApi: {
    updateMonthlyCategory: vi.fn(),
    updateAnnualCategory: vi.fn(),
    getFeeEnrollments: vi.fn(),
    bulkEnrollFees: vi.fn(),
    endFeeEnrollments: vi.fn(),
  },
  studentsApi: { getStudents: vi.fn() },
}))
vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ activeAcademicYear: { id: 1 } }),
}))
vi.mock('../../../hooks/useSessionClasses', () => ({
  useSessionClasses: () => ({ sessionClasses: [{ id: 9, class_obj: 3, display_name: 'Class 5', section: 'A', is_active: true }] }),
}))

const robotics = { id: 4, name: 'Robotics', billing_mode: 'ENROLLED', default_amount: '1500.00', enrolled_count: 1 }

describe('OptionalFeeModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    financeApi.getFeeEnrollments.mockResolvedValue({
      data: [{ id: 1, student: 10, student_name: 'Ali', class_label: 'Class 5 - A', start_date: '2026-03-01', end_date: null, amount: null, is_active: true }],
    })
    studentsApi.getStudents.mockResolvedValue({ data: { results: [{ id: 10, name: 'Ali' }, { id: 11, name: 'Sara', roll_number: '2' }] } })
  })

  it('switches a category to enrolled-only with a price', async () => {
    financeApi.updateMonthlyCategory.mockResolvedValue({ data: {} })
    renderWithProviders(<OptionalFeeModal category={{ id: 4, name: 'Robotics', billing_mode: 'ALL', default_amount: null }} kind="MONTHLY" onClose={vi.fn()} />)
    fireEvent.click(screen.getByLabelText(/Enrolled students only/))
    fireEvent.change(screen.getByPlaceholderText('e.g. 1500'), { target: { value: '1500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save billing' }))
    await waitFor(() => expect(financeApi.updateMonthlyCategory).toHaveBeenCalledWith(4, { billing_mode: 'ENROLLED', default_amount: '1500' }))
    expect(financeApi.getFeeEnrollments).not.toHaveBeenCalled()
  })

  it('lists enrolled students and enrolls only the ones not yet enrolled', async () => {
    financeApi.bulkEnrollFees.mockResolvedValue({ data: { created: 1, skipped: 0 } })
    renderWithProviders(<OptionalFeeModal category={robotics} kind="MONTHLY" onClose={vi.fn()} />)
    expect(await screen.findByText('Class 5 - A')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Class'), { target: { value: '9' } })
    const sara = await screen.findByLabelText('2. Sara')
    expect(screen.queryByLabelText('Ali')).not.toBeInTheDocument()
    fireEvent.click(sara)
    fireEvent.click(screen.getByRole('button', { name: /Enroll 1 student/ }))
    await waitFor(() => expect(financeApi.bulkEnrollFees).toHaveBeenCalledWith(expect.objectContaining({
      monthly_category: 4, student_ids: [11], amount: null, academic_year: 1,
    })))
    expect(await screen.findByText('1 enrolled.')).toBeInTheDocument()
  })

  it('ends an enrollment on the chosen date', async () => {
    financeApi.endFeeEnrollments.mockResolvedValue({ data: { ended: 1 } })
    renderWithProviders(<OptionalFeeModal category={robotics} kind="ANNUAL" onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'End' }))
    await waitFor(() => expect(financeApi.endFeeEnrollments).toHaveBeenCalledWith(expect.objectContaining({ ids: [1] })))
    expect(financeApi.getFeeEnrollments).toHaveBeenCalledWith({ annual_category: 4, status: 'active' })
  })

  it('read-only users cannot change anything', async () => {
    renderWithProviders(<OptionalFeeModal category={robotics} kind="MONTHLY" onClose={vi.fn()} canEdit={false} />)
    expect(await screen.findByText('Class 5 - A')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'End' })).not.toBeInTheDocument()
    expect(screen.queryByText('Add students')).not.toBeInTheDocument()
  })
})
