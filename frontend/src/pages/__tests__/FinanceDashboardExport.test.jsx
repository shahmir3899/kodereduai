import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../test/utils'
import FinanceDashboardPage from '../FinanceDashboardPage'

// The finance PDF comes from /api/reports/generate-instant/, which only admin roles may call,
// so a finance manager (a MANAGER with can_manage_finance) must not see a button that 403s.
let auth
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../../contexts/AcademicYearContext', () => ({ useAcademicYear: () => ({ activeAcademicYear: { id: 1, name: '2026-27' } }) }))

const base = { activeSchool: { id: 1, name: 'Test School' }, isStaffMember: false }

describe('Finance dashboard PDF export', () => {
  beforeEach(() => { auth = null })

  it('is shown to a school admin', async () => {
    auth = { ...base, user: { id: 1, role: 'SCHOOL_ADMIN', schools: [{ id: 1 }] }, isPrincipal: false, isSchoolAdmin: true }
    renderWithProviders(<FinanceDashboardPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: /PDF/ })).toBeInTheDocument())
  })

  it('is hidden from a finance manager', async () => {
    auth = { ...base, user: { id: 2, role: 'MANAGER', schools: [{ id: 1 }] }, isPrincipal: false, isSchoolAdmin: false, canManageFinance: true }
    renderWithProviders(<FinanceDashboardPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Custom' })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /PDF/ })).not.toBeInTheDocument()
  })
})
