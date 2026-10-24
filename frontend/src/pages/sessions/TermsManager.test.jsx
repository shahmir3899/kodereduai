import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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
vi.mock('../../components/ConfirmModal', () => ({ useConfirmModal: () => ({ confirm: vi.fn().mockResolvedValue(true), ConfirmModalRoot: () => null }) }))

import TermsManager from './TermsManager'

const year = { id: 1, name: '2026-27', start_date: '2026-04-01', end_date: '2027-03-31' }
const term1 = { id: 10, academic_year: 1, name: 'Term 1', term_type: 'TERM', order: 1, start_date: '2026-04-01', end_date: '2026-07-31' }
const term2 = { id: 11, academic_year: 1, name: 'Term 2', term_type: 'TERM', order: 2, start_date: '2026-08-01', end_date: '2026-11-30' }

function renderManager() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TermsManager year={year} />
    </QueryClientProvider>,
  )
}

// The same name shows on the bar and in the list, so pick the list entry.
const listEntry = (name) => screen.getAllByText(name).find(el => el.tagName === 'P')

async function selectTerm(name) {
  await screen.findByText('2 terms')
  await userEvent.click(listEntry(name))
  await screen.findByLabelText(/Start date/)
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getTerms.mockResolvedValue({ data: { results: [term1, term2] } })
  api.updateTerm.mockResolvedValue({ data: {} })
  api.createTerm.mockResolvedValue({ data: { ...term2, id: 12, name: 'Term 3', order: 3, start_date: '2026-12-01', end_date: '2027-02-28' } })
})

describe('TermsManager', () => {
  it('has one timeline bar and no extra slider row, and shows fields only after a term is picked', async () => {
    renderManager()
    await screen.findByText('2 terms')
    expect(screen.queryByLabelText(/Start date/)).not.toBeInTheDocument()
    expect(screen.queryAllByRole('slider')).toHaveLength(0)
    await userEvent.click(listEntry('Term 1'))
    expect(await screen.findByLabelText(/Start date/)).toHaveValue('2026-04-01')
    // the two edge handles live on the single bar
    expect(screen.getAllByRole('slider')).toHaveLength(2)
  })

  it('autosaves a typed change after a pause, without a save button', async () => {
    renderManager()
    await selectTerm('Term 2')
    const end = screen.getByLabelText(/End date/)
    fireEvent.change(end, { target: { value: '2026-12-15' } })
    await waitFor(() => expect(api.updateTerm).toHaveBeenCalledTimes(1), { timeout: 3000 })
    expect(api.updateTerm.mock.calls[0][0]).toBe(11)
    expect(api.updateTerm.mock.calls[0][1]).toMatchObject({ end_date: '2026-12-15' })
    expect(api.updateTerm.mock.calls[0][1]).not.toHaveProperty('confirm_warnings')
    expect(await screen.findByText('All changes saved')).toBeInTheDocument()
  })

  it('moves a term edge with the arrow keys on the bar and autosaves it', async () => {
    renderManager()
    await selectTerm('Term 2')
    const endHandle = screen.getByRole('slider', { name: 'Term end' })
    endHandle.focus()
    fireEvent.keyDown(endHandle, { key: 'ArrowRight' })
    expect(screen.getByLabelText(/End date/)).toHaveValue('2026-12-01')
    await waitFor(() => expect(api.updateTerm).toHaveBeenCalled(), { timeout: 3000 })
    expect(api.updateTerm.mock.calls[0][1]).toMatchObject({ end_date: '2026-12-01' })
  })

  it('holds an overlapping change back, and saves it only with "Save anyway"', async () => {
    renderManager()
    await selectTerm('Term 2')
    fireEvent.change(screen.getByLabelText(/Start date/), { target: { value: '2026-06-01' } })
    expect(await screen.findByText(/not saved yet/i)).toBeInTheDocument()
    expect(screen.getByText(/Not saved: overlaps Term 1/)).toBeInTheDocument()
    await new Promise(r => setTimeout(r, 1000))
    expect(api.updateTerm).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Save anyway' }))
    await waitFor(() => expect(api.updateTerm).toHaveBeenCalledTimes(1))
    expect(api.updateTerm.mock.calls[0][1]).toMatchObject({ start_date: '2026-06-01', confirm_warnings: true })
  })

  it('creates the next term straight away with suggested dates and selects it', async () => {
    renderManager()
    await screen.findByText('2 terms')
    await userEvent.click(screen.getByRole('button', { name: '+ Add Term' }))
    await waitFor(() => expect(api.createTerm).toHaveBeenCalled())
    expect(api.createTerm.mock.calls[0][0]).toMatchObject({ academic_year: 1, name: 'Term 3', order: 3, start_date: '2026-12-01' })
    expect(await screen.findByLabelText('Name *')).toHaveValue('Term 3')
  })

  it('offers "Save anyway" when the server asks for confirmation', async () => {
    api.updateTerm.mockRejectedValueOnce({
      response: { data: { non_field_errors: ['Term date range overlaps with Term 1.'], confirm_warnings: ['Confirm'] } },
    })
    renderManager()
    await selectTerm('Term 2')
    fireEvent.change(screen.getByLabelText(/End date/), { target: { value: '2026-12-15' } })
    expect(await screen.findByText('Term date range overlaps with Term 1.', {}, { timeout: 3000 })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save anyway' }))
    await waitFor(() => expect(api.updateTerm).toHaveBeenCalledTimes(2))
    expect(api.updateTerm.mock.calls[1][1].confirm_warnings).toBe(true)
  })
})
