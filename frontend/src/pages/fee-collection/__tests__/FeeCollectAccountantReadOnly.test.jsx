import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import FeeCollectPage from '../FeeCollectPage'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 2, role: 'ACCOUNTANT' },
    activeSchool: { id: 1, name: 'Test School' },
    effectiveRole: 'ACCOUNTANT',
    isSchoolAdmin: false, isAccountant: true, isPrincipal: false, isSuperAdmin: false, isStaffMember: false,
  }),
}))
vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ activeAcademicYear: { id: 1, name: '2025-2026' } }),
}))
vi.mock('../../../contexts/BackgroundTaskContext', () => ({
  useBackgroundTasks: () => ({ addTask: vi.fn(), tasks: [] }),
}))
vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ addToast: vi.fn(), showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() }),
}))

const payment = {
  id: 11, student: 5, student_name: 'Ali Hassan', student_roll: '1', class_name: 'Class 1A',
  fee_type: 'MONTHLY', month: 10, year: 2026, amount_due: 3000, amount_paid: 0, balance: 3000, status: 'UNPAID',
}

// The accountant is read-only in finance (bulk_update answers 403), so the page must not offer
// row checkboxes or the bulk Update / Pay Full bar.
describe('Collect Payments as accountant', () => {
  it('shows no selection checkboxes', async () => {
    server.use(http.get('/api/finance/fee-payments/', () =>
      HttpResponse.json({ count: 1, next: null, previous: null, results: [payment] })))
    renderWithProviders(<FeeCollectPage />)
    await waitFor(() => expect(screen.getAllByText('Ali Hassan').length).toBeGreaterThan(0))
    expect(document.querySelectorAll('input[type=checkbox]')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Pay Full' })).toBeNull()
  })
})
