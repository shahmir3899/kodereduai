import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import PayrollPage from '../PayrollPage'

const toast = { showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(), addToast: vi.fn() }

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'SCHOOL_ADMIN', schools: [{ id: 1 }] },
    activeSchool: { id: 1, name: 'Test School' },
    isStaffMember: false, isPrincipal: false, isAccountant: false,
  }),
}))
vi.mock('../../../hooks/useBackgroundTask', () => ({ useBackgroundTask: () => ({ isSubmitting: false, submit: vi.fn() }) }))
vi.mock('../../../components/Toast', () => ({ useToast: () => toast }))

const now = new Date()
const payslip = {
  id: 9, staff_member: 3, staff_member_name: 'Bilal Ahmed', status: 'DRAFT', status_display: 'Draft',
  month: now.getMonth() + 1, year: now.getFullYear(), basic_salary: '40000', net_salary: '47500',
  allowances: {}, deductions: {},
}

describe('Payroll PDF download', () => {
  beforeEach(() => {
    Object.values(toast).forEach((f) => f.mockClear())
    window.URL.createObjectURL = vi.fn(() => 'blob:x')
    window.URL.revokeObjectURL = vi.fn()
    server.use(
      http.get('/api/hr/payslips/', () => HttpResponse.json({ count: 1, results: [payslip] })),
      http.get('/api/hr/payslips/payroll_summary/', () => HttpResponse.json({})),
      http.get('/api/hr/payslips/net_pay_history/', () => HttpResponse.json({ results: [] })),
      http.get('/api/hr/payslips/9/download-pdf/', () => new HttpResponse('%PDF-1.4', { headers: { 'Content-Type': 'application/pdf' } })),
    )
  })

  it('says "Payslip PDF downloaded" after the PDF button', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PayrollPage />)
    const [pdf] = await screen.findAllByRole('button', { name: 'PDF' })
    await user.click(pdf)
    await waitFor(() => expect(toast.showSuccess).toHaveBeenCalledWith('Payslip PDF downloaded'))
  })
})
