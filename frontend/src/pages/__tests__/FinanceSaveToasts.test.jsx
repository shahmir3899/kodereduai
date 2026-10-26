import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/utils'
import AccountsPage from '../AccountsPage'
import ExpensesPage from '../ExpensesPage'
import OtherIncomePage from '../fee-collection/OtherIncomePage'

const toast = { showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(), addToast: vi.fn() }

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'SCHOOL_ADMIN', schools: [{ id: 1 }] },
    activeSchool: { id: 1, name: 'Test School' },
    isStaffMember: false, isPrincipal: false, isAccountant: false,
  }),
}))
vi.mock('../../components/Toast', () => ({ useToast: () => toast }))

const accounts = [
  { id: 1, name: 'Main Cash', account_type: 'CASH', is_active: true, staff_visible: true },
  { id: 2, name: 'School Bank', account_type: 'BANK', is_active: true, staff_visible: true },
]

describe('Finance saves announce themselves', () => {
  beforeEach(() => {
    Object.values(toast).forEach((f) => f.mockClear())
    server.use(
      http.get('/api/finance/accounts/', () => HttpResponse.json({ count: 2, results: accounts })),
      http.get('/api/finance/accounts/balances/', () => HttpResponse.json({ accounts: [], grand_total: 0 })),
      http.get('/api/finance/accounts/closings/', () => HttpResponse.json([])),
      http.get('/api/finance/transfers/', () => HttpResponse.json({ count: 0, results: [] })),
      http.post('/api/finance/transfers/', () => HttpResponse.json({ id: 1 }, { status: 201 })),
      http.post('/api/finance/accounts/close_month/', () => HttpResponse.json({ ok: true })),
      http.get('/api/finance/expense-categories/', () => HttpResponse.json({ count: 1, results: [{ id: 5, name: 'Utilities' }] })),
      http.get('/api/finance/expenses/', () => HttpResponse.json({ count: 0, results: [] })),
      http.post('/api/finance/expenses/', () => HttpResponse.json({ id: 1 }, { status: 201 })),
      http.get('/api/finance/income-categories/', () => HttpResponse.json({ count: 1, results: [{ id: 7, name: 'Donations' }] })),
      http.get('/api/finance/other-income/', () => HttpResponse.json({ count: 0, results: [] })),
      http.post('/api/finance/other-income/', () => HttpResponse.json({ id: 1 }, { status: 201 })),
    )
  })

  it('Close Month says "Month closed"', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AccountsPage />)
    const [open] = await screen.findAllByRole('button', { name: 'Close Month' })
    await user.click(open)
    await user.click(await screen.findByLabelText('I understand, close this period'))
    const buttons = screen.getAllByRole('button', { name: 'Close Month' })
    await user.click(buttons[buttons.length - 1])
    await waitFor(() => expect(toast.showSuccess).toHaveBeenCalledWith('Month closed'))
  })

  it('Confirm Transfer says "Transfer recorded"', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AccountsPage />)
    await user.click(await screen.findByRole('button', { name: 'Transfers' }))
    await user.click(await screen.findByRole('button', { name: 'Record Transfer' }))
    const dialog = (await screen.findByRole('heading', { name: 'Record Transfer', level: 3 })).parentElement
    const [from, to] = within(dialog).getAllByRole('combobox')
    await user.selectOptions(from, '1')
    await user.selectOptions(to, '2')
    await user.type(dialog.querySelector('input[type=number]'), '5000')
    await user.click(within(dialog).getByRole('button', { name: 'Review Transfer' }))
    await user.click(await screen.findByRole('button', { name: 'Confirm Transfer' }))
    await waitFor(() => expect(toast.showSuccess).toHaveBeenCalledWith('Transfer recorded'))
  })

  it('Add Expense says "Expense recorded"', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ExpensesPage />)
    await user.click(await screen.findByRole('button', { name: 'Add Expense' }))
    await user.type(await screen.findByPlaceholderText('0.00'), '1200')
    const fixed = document.querySelector('form')
    const [category, account] = within(fixed).getAllByRole('combobox')
    await user.selectOptions(category, '5')
    await user.selectOptions(account, '1')
    fireEvent.submit(fixed)
    await waitFor(() => expect(toast.showSuccess).toHaveBeenCalledWith('Expense recorded'))
  })

  it('Add Income says "Income recorded"', async () => {
    const user = userEvent.setup()
    renderWithProviders(<OtherIncomePage />)
    await user.click(await screen.findByRole('button', { name: 'Add Income' }))
    await user.type(await screen.findByPlaceholderText('0.00'), '2500')
    const form = document.querySelector('form')
    const [category, account] = within(form).getAllByRole('combobox')
    await user.selectOptions(category, '7')
    await user.selectOptions(account, '1')
    fireEvent.submit(form)
    await waitFor(() => expect(toast.showSuccess).toHaveBeenCalledWith('Income recorded'))
  })
})
