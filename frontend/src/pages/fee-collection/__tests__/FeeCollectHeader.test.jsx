import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import FeeCollectPage from '../FeeCollectPage'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'SCHOOL_ADMIN' },
    activeSchool: { id: 1, name: 'Test School' },
    effectiveRole: 'SCHOOL_ADMIN',
    isSchoolAdmin: true, isAccountant: false, isPrincipal: false, isSuperAdmin: false, isStaffMember: false,
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

// Regression: "Export PDF" used to mount only after records loaded, shifting the right-aligned header
// buttons left and making an early click on "Generate Single Fee Record" land on its neighbour.
describe('Collect Payments header', () => {
  it('keeps the same buttons (Export PDF disabled) while records load, and enables it afterwards', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    server.use(http.get('/api/finance/fee-payments/', async () => {
      await gate
      return HttpResponse.json({ count: 1, next: null, previous: null, results: [payment] })
    }))
    renderWithProviders(<FeeCollectPage />)

    const labels = () => ['Generate Single Fee Record', 'Generate Multiple Fee Records', 'Export PDF']
    for (const l of labels()) expect(await screen.findByRole('button', { name: l })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeDisabled()

    release()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export PDF' })).toBeEnabled())
    for (const l of labels()) expect(screen.getAllByRole('button', { name: l })).toHaveLength(1)
  })
})
