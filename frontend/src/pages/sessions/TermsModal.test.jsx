import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const api = vi.hoisted(() => ({
  getTerms: vi.fn(),
  createTerm: vi.fn(),
  updateTerm: vi.fn(),
  deleteTerm: vi.fn(),
}))
vi.mock('../../services/api', () => ({ sessionsApi: api }))
vi.mock('../../components/Toast', () => ({ useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) }))
vi.mock('../../components/ConfirmModal', () => ({ useConfirmModal: () => ({ confirm: vi.fn(), ConfirmModalRoot: () => null }) }))

import TermsModal from './TermsModal'

const year = { id: 1, name: '2026-27', start_date: '2026-04-01', end_date: '2027-03-31' }
const term1 = { id: 10, academic_year: 1, name: 'Term 1', term_type: 'TERM', order: 1, start_date: '2026-04-01', end_date: '2026-07-31' }

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TermsModal year={year} onClose={() => {}} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getTerms.mockResolvedValue({ data: { results: [term1] } })
  api.createTerm.mockResolvedValue({ data: {} })
})

describe('TermsModal', () => {
  it('lists the year terms and suggests the next term starting the day after the last one', async () => {
    renderModal()
    expect(await screen.findByText('1 term')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '+ Add Term' }))
    expect(screen.getByLabelText(/Start date/)).toHaveValue('2026-08-01')
    expect(screen.getByLabelText('Name *')).toHaveValue('Term 2')
  })

  it('warns live about an overlap and saves it only as "Save anyway" with the confirm flag', async () => {
    renderModal()
    await screen.findByText('1 term')
    await userEvent.click(screen.getByRole('button', { name: '+ Add Term' }))

    const start = screen.getByLabelText(/Start date/)
    await userEvent.clear(start)
    await userEvent.type(start, '2026-06-01')

    expect(screen.getByText(/overlap another term/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save anyway' }))

    await waitFor(() => expect(api.createTerm).toHaveBeenCalled())
    expect(api.createTerm.mock.calls[0][0]).toMatchObject({ academic_year: 1, start_date: '2026-06-01', confirm_warnings: true })
  })

  it('saves a clean term without the confirm flag', async () => {
    renderModal()
    await screen.findByText('1 term')
    await userEvent.click(screen.getByRole('button', { name: '+ Add Term' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(api.createTerm).toHaveBeenCalled())
    expect(api.createTerm.mock.calls[0][0]).not.toHaveProperty('confirm_warnings')
  })

  it('offers "Save anyway" when the server asks for confirmation', async () => {
    api.createTerm.mockRejectedValueOnce({
      response: { data: { non_field_errors: ['Term date range overlaps with Term 1.'], confirm_warnings: ['Confirm'] } },
    })
    renderModal()
    await screen.findByText('1 term')
    await userEvent.click(screen.getByRole('button', { name: '+ Add Term' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('Term date range overlaps with Term 1.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save anyway' }))
    await waitFor(() => expect(api.createTerm).toHaveBeenCalledTimes(2))
    expect(api.createTerm.mock.calls[1][0].confirm_warnings).toBe(true)
  })
})
