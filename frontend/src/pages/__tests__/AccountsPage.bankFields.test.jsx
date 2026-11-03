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

const BANK_LABELS = ['Bank Name', 'Account Title', 'Account Number', 'IBAN (optional)']

async function openAddAccount() {
  const user = userEvent.setup()
  renderWithProviders(<AccountsPage />)
  await user.click(await screen.findByRole('button', { name: 'Manage Accounts' }))
  await user.click(await screen.findByRole('button', { name: /Add Account/ }))
  await screen.findByPlaceholderText('e.g. Principal Branch 1')
  return user
}

describe('Accounts form: bank details', () => {
  let posted
  beforeEach(() => {
    posted = null
    server.use(
      http.post('/api/finance/accounts/', async ({ request }) => {
        posted = await request.json()
        return HttpResponse.json({ id: 99, name: posted.name }, { status: 201 })
      }),
      http.get('/api/finance/accounts/balances/', () => HttpResponse.json({ accounts: [], grand_total: 0 })),
    )
  })

  it('shows no bank fields for a Cash account', async () => {
    await openAddAccount()
    BANK_LABELS.forEach((label) => expect(screen.queryByText(label)).toBeNull())
  })

  it('shows the bank name, title, number and IBAN only once the type is Bank, and hides them again otherwise', async () => {
    const user = await openAddAccount()
    const type = screen.getByDisplayValue('Cash')
    await user.selectOptions(type, 'BANK')
    BANK_LABELS.forEach((label) => expect(screen.getByText(label)).toBeTruthy())
    await user.selectOptions(type, 'PERSON')
    BANK_LABELS.forEach((label) => expect(screen.queryByText(label)).toBeNull())
  })

  it('sends the typed bank details with a Bank account', async () => {
    const user = await openAddAccount()
    await user.type(screen.getByPlaceholderText('e.g. Principal Branch 1'), 'Settlement')
    await user.selectOptions(screen.getByDisplayValue('Cash'), 'BANK')
    await user.type(screen.getByPlaceholderText('e.g. HBL'), 'HBL')
    await user.type(screen.getByPlaceholderText('Name the account is held in'), 'The Focus School')
    await user.type(screen.getByPlaceholderText('Letters, digits, spaces and hyphens'), '0123-4567')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(posted).not.toBeNull())
    expect(posted).toMatchObject({ account_type: 'BANK', bank_name: 'HBL', account_title: 'The Focus School', account_number: '0123-4567' })
  })

  it('sends blank bank details for an account that is not a Bank, even if some were typed first', async () => {
    const user = await openAddAccount()
    await user.type(screen.getByPlaceholderText('e.g. Principal Branch 1'), 'Petty')
    const type = screen.getByDisplayValue('Cash')
    await user.selectOptions(type, 'BANK')
    await user.type(screen.getByPlaceholderText('e.g. HBL'), 'HBL')
    await user.selectOptions(type, 'CASH')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(posted).not.toBeNull())
    expect(posted).toMatchObject({ account_type: 'CASH', bank_name: '', account_title: '', account_number: '', iban: '' })
  })
})
