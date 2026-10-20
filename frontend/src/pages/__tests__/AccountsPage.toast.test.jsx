import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/utils'
import AccountsPage from '../AccountsPage'

const toast = { showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(), addToast: vi.fn() }

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'SCHOOL_ADMIN', schools: [{ id: 1 }] },
    activeSchool: { id: 1, name: 'Test School' },
    isStaffMember: false, isPrincipal: false,
  }),
}))
vi.mock('../../components/Toast', () => ({ useToast: () => toast }))

describe('Accounts page save feedback', () => {
  beforeEach(() => {
    Object.values(toast).forEach((f) => f.mockClear())
    server.use(
      http.post('/api/finance/accounts/', () => HttpResponse.json({ id: 99, name: 'Petty Cash' }, { status: 201 })),
      http.get('/api/finance/accounts/balances/', () => HttpResponse.json({ accounts: [], grand_total: 0 })),
    )
  })

  it('shows "Account created" after saving a new account', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AccountsPage />)
    await user.click(await screen.findByRole('button', { name: 'Manage Accounts' }))
    await user.click(await screen.findByRole('button', { name: /Add Account/ }))
    await user.type(await screen.findByPlaceholderText('e.g. Principal Branch 1'), 'Petty Cash')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(toast.showSuccess).toHaveBeenCalledWith('Account created'))
  })
})
