import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import MonthlyChargesCardView from '../MonthlyChargesCardView'
import AnnualChargesCardView from '../AnnualChargesCardView'
import FeeTable from '../FeeTable'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'SCHOOL_ADMIN' },
    activeSchool: { id: 1, name: 'Test School' },
    effectiveRole: 'SCHOOL_ADMIN',
    isStaffMember: false,
  }),
}))

vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ activeAcademicYear: { id: 1, name: '2025-2026' } }),
}))

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ addToast: vi.fn(), showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() }),
}))

let errors
beforeEach(() => {
  errors = []
  vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args.map(String).join(' ')) })
})
afterEach(() => vi.restoreAllMocks())

// Classes load but the fee-structure query stays pending: the window in which an unstable `[]` fallback
// used to re-run the "initialise rows" effect on every render ("Maximum update depth exceeded").
function holdStructuresPending() {
  server.use(
    http.get('/api/finance/fee-structures/', async () => { await new Promise(() => {}) }),
    http.get('/api/finance/monthly-categories/', () => HttpResponse.json({ results: [] })),
    http.get('/api/finance/annual-categories/', () => HttpResponse.json({ results: [] })),
  )
}

describe('fee structure card views while structures are still loading', () => {
  it('Monthly Structure does not loop on setState', async () => {
    holdStructuresPending()
    renderWithProviders(<MonthlyChargesCardView />)
    // classes resolve quickly; give the effect time to loop if it is going to
    await new Promise((r) => setTimeout(r, 900))
    expect(errors.filter((e) => e.includes('Maximum update depth'))).toEqual([])
  })

  it('Annual Charges does not loop on setState', async () => {
    holdStructuresPending()
    renderWithProviders(<AnnualChargesCardView />)
    // classes resolve quickly; give the effect time to loop if it is going to
    await new Promise((r) => setTimeout(r, 900))
    expect(errors.filter((e) => e.includes('Maximum update depth'))).toEqual([])
  })
})

describe('FeeTable list keys', () => {
  it('renders fee rows without a React key warning', async () => {
    const payment = {
      id: 11, student: 5, student_name: 'Ali Hassan', student_roll: '1', class_name: 'Class 1A',
      fee_type: 'MONTHLY', month: 10, year: 2026, amount_due: 3000, amount_paid: 0, balance: 3000, status: 'UNPAID',
    }
    const props = {
      paymentList: [payment, { ...payment, id: 12, student: 6, student_name: 'Sara Khan', student_roll: '2' }],
      selectedIds: new Set(), isLoading: false, canWrite: true,
      onToggleSelect: vi.fn(), onToggleAll: vi.fn(), onRecordPayment: vi.fn(),
      onDelete: vi.fn(), onUpdateField: vi.fn(),
    }
    renderWithProviders(<FeeTable {...props} />)
    await waitFor(() => expect(screen.getAllByText(/Ali Hassan/).length).toBeGreaterThan(0))
    expect(errors.filter((e) => e.includes('unique "key"'))).toEqual([])
  })
})
