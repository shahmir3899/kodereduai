import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../../test/mocks/server'
import { renderWithProviders } from '../../../../test/utils'
import StudentExitWizard from '../StudentExitWizard'

const mockShowSuccess = vi.fn()
const mockShowError = vi.fn()
vi.mock('../../../../components/Toast', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError, showWarning: vi.fn() }),
}))

const student = { id: 5, name: 'Ali Hassan', roll_number: '9', class_name: 'Class 1A' }

const item = (kind, over = {}) => ({
  id: kind, kind, kind_label: { FEES: 'Pending fees', LIBRARY: 'Library books', GATE_PASS: 'Open gate pass' }[kind],
  state: 'CLEAR', summary: '', detail: {}, amount: null, waiver_reason: '', waived_by_name: null, waived_at: null, ...over,
})

const feesOpen = item('FEES', {
  state: 'OPEN', summary: 'PKR 1,500 pending', amount: '1500.00',
  detail: { items: [{ label: 'Tuition', fee_type: 'MONTHLY', month: 2, year: 2026, balance: '1500.00' }] },
})

const makeExit = (over = {}) => ({
  id: 70, student: 5, status: 'OPEN', exit_type: 'WITHDRAWN', exit_type_label: 'Withdrawn (left school)',
  leaving_date: '2026-03-01', reason: 'Family relocated', destination_school: null, destination_school_name: null,
  remove_records_after_leaving: false, items: [item('FEES'), item('LIBRARY'), item('GATE_PASS')], open_item_count: 0, ...over,
})

// A tiny stand-in for the API: holds one exit and applies the calls the wizard makes.
let current
let calls

function mockApi({ existing = null, destinations = [{ id: 2, name: 'Branch 2' }] } = {}) {
  current = existing
  calls = []
  server.use(
    http.get('/api/student-exits/', () => HttpResponse.json({ count: current ? 1 : 0, results: current ? [current] : [] })),
    http.get('/api/student-exits/destinations/', () => HttpResponse.json(destinations)),
    http.post('/api/student-exits/', async ({ request }) => {
      const body = await request.json()
      calls.push(['start', body])
      if (body.leaving_date === '2026-03-01' && body.__conflict) return HttpResponse.json({}, { status: 400 })
      current = makeExit({ ...body, exit_type: body.exit_type, items: [feesOpen, item('LIBRARY'), item('GATE_PASS')], open_item_count: 1 })
      return HttpResponse.json(current, { status: 201 })
    }),
    http.post('/api/student-exits/:id/items/:kind/waive/', async ({ request, params }) => {
      const { reason } = await request.json()
      calls.push(['waive', params.kind, reason])
      if (reason.length < 10) return HttpResponse.json({ detail: 'Give a reason of at least 10 characters to waive this item.' }, { status: 400 })
      current = {
        ...current, open_item_count: 0,
        items: current.items.map((i) => (i.kind === params.kind
          ? { ...i, state: 'WAIVED', waiver_reason: reason, waived_by_name: 'admin', waived_at: '2026-03-02T10:00:00Z' } : i)),
      }
      return HttpResponse.json(current)
    }),
    http.post('/api/student-exits/:id/items/:kind/unwaive/', ({ params }) => {
      calls.push(['unwaive', params.kind])
      current = { ...current, open_item_count: 1, items: current.items.map((i) => (i.kind === params.kind ? { ...i, state: 'OPEN', waiver_reason: '' } : i)) }
      return HttpResponse.json(current)
    }),
    http.post('/api/student-exits/:id/refresh/', () => {
      calls.push(['refresh'])
      return HttpResponse.json(current)
    }),
    http.patch('/api/student-exits/:id/', async ({ request }) => {
      const body = await request.json()
      calls.push(['update', body])
      current = { ...current, ...body }
      return HttpResponse.json(current)
    }),
    http.post('/api/student-exits/:id/finalize/', () => {
      calls.push(['finalize'])
      return HttpResponse.json({ ...current, status: 'FINALIZED' })
    }),
    http.post('/api/student-exits/:id/cancel/', async ({ request }) => {
      calls.push(['cancel', (await request.json()).reason])
      return HttpResponse.json({ ...current, status: 'CANCELLED' })
    }),
  )
}

async function renderWizard(props = {}) {
  const onClose = vi.fn()
  const user = userEvent.setup()
  renderWithProviders(<StudentExitWizard student={student} onClose={onClose} {...props} />)
  await screen.findByRole('heading', { name: 'Student exit' })
  return { user, onClose }
}

describe('StudentExitWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('details step', () => {
    it('starts a withdrawal and moves to the clearance checklist', async () => {
      mockApi()
      const { user } = await renderWizard({ prefill: { exit_type: 'WITHDRAWN', leaving_date: '2026-03-01', reason: 'Moving away' } })

      await user.click(screen.getByRole('button', { name: 'Continue' }))

      await screen.findByTestId('item-FEES')
      expect(calls[0]).toEqual(['start', {
        student: 5, exit_type: 'WITHDRAWN', leaving_date: '2026-03-01', reason: 'Moving away',
        destination_school: null, remove_records_after_leaving: false,
      }])
      expect(within(screen.getByTestId('item-FEES')).getByText('PKR 1,500 pending')).toBeInTheDocument()
      expect(within(screen.getByTestId('item-LIBRARY')).getByText('Clear')).toBeInTheDocument()
    })

    it('requires a leaving date', async () => {
      mockApi()
      const { user } = await renderWizard({ prefill: { exit_type: 'WITHDRAWN', leaving_date: '' } })
      await user.clear(screen.getByLabelText('Leaving date'))

      await user.click(screen.getByRole('button', { name: 'Continue' }))

      expect(screen.getByRole('alert')).toHaveTextContent('A leaving date is required.')
      expect(calls).toHaveLength(0)
    })

    it('offers the other branches for a transfer and needs one chosen', async () => {
      mockApi()
      const { user } = await renderWizard({ prefill: { exit_type: 'TRANSFERRED', leaving_date: '2026-03-01' } })

      expect(await screen.findByRole('option', { name: 'Branch 2' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Continue' }))
      expect(screen.getByRole('alert')).toHaveTextContent('Choose the branch the student is transferring to.')

      await user.selectOptions(screen.getByLabelText('Transferring to'), 'Branch 2')
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      await screen.findByTestId('item-FEES')
      expect(calls[0][1]).toMatchObject({ exit_type: 'TRANSFERRED', destination_school: 2 })
    })

    it('says so when the organization has no other branch', async () => {
      mockApi({ destinations: [] })
      await renderWizard({ prefill: { exit_type: 'TRANSFERRED' } })

      expect(await screen.findByText('No other active branch in your organization.')).toBeInTheDocument()
    })

    it('shows the records-after-leaving conflict and lets the admin take the suggested date', async () => {
      mockApi()
      const conflict = {
        code: 'records_after_leaving', student_name: 'Ali Hassan', leaving_date: '2026-03-01',
        suggested_leaving_date: '2026-03-10', last_record_date: '2026-03-09',
        attendance: { count: 4, first_date: '2026-03-02', last_date: '2026-03-09', present: 3, absent: 1 },
        marks: { count: 0, exams: [] },
      }
      server.use(http.post('/api/student-exits/', () => HttpResponse.json(conflict, { status: 400 })))
      const { user } = await renderWizard({ prefill: { exit_type: 'WITHDRAWN', leaving_date: '2026-03-01' } })

      await user.click(screen.getByRole('button', { name: 'Continue' }))

      expect(await screen.findByText('Records exist after this leaving date')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
      await user.click(screen.getByRole('button', { name: /use .* as the leaving date/i }))
      expect(screen.getByLabelText('Leaving date')).toHaveValue('2026-03-10')
      expect(screen.queryByText('Records exist after this leaving date')).not.toBeInTheDocument()
    })

    it('lets the admin choose to remove the records and sends that flag', async () => {
      mockApi()
      const conflict = {
        code: 'records_after_leaving', student_name: 'Ali Hassan', leaving_date: '2026-03-01',
        suggested_leaving_date: '2026-03-10', last_record_date: '2026-03-09',
        attendance: { count: 1, first_date: '2026-03-02', last_date: '2026-03-02' }, marks: {},
      }
      let first = true
      server.use(http.post('/api/student-exits/', async ({ request }) => {
        const body = await request.json()
        calls.push(['start', body])
        if (first) {
          first = false
          return HttpResponse.json(conflict, { status: 400 })
        }
        current = makeExit({ remove_records_after_leaving: true, items: [item('FEES')] })
        return HttpResponse.json(current, { status: 201 })
      }))
      const { user } = await renderWizard({ prefill: { exit_type: 'WITHDRAWN', leaving_date: '2026-03-01' } })

      await user.click(screen.getByRole('button', { name: 'Continue' }))
      await user.click(await screen.findByRole('checkbox'))
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      await screen.findByTestId('item-FEES')
      expect(calls[1][1]).toMatchObject({ remove_records_after_leaving: true })
    })

    it('shows other server errors in the wizard', async () => {
      mockApi()
      server.use(http.post('/api/student-exits/', () => HttpResponse.json({ detail: 'Ali Hassan already has an exit in progress.' }, { status: 400 })))
      const { user } = await renderWizard({ prefill: { exit_type: 'WITHDRAWN', leaving_date: '2026-03-01' } })

      await user.click(screen.getByRole('button', { name: 'Continue' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('already has an exit in progress')
    })
  })

  describe('clearance and review', () => {
    const openCase = () => makeExit({ items: [feesOpen, item('LIBRARY'), item('GATE_PASS')], open_item_count: 1 })

    it('resumes an exit already in progress straight at the checklist', async () => {
      mockApi({ existing: openCase() })
      await renderWizard()

      expect(await screen.findByTestId('item-FEES')).toBeInTheDocument()
      expect(screen.queryByLabelText('Leaving date')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    })

    it('lists the fee breakdown, books and passes that are holding things up', async () => {
      mockApi({
        existing: makeExit({
          items: [
            feesOpen,
            item('LIBRARY', { state: 'OPEN', summary: '1 book not returned', detail: { books: [{ id: 1, title: 'Atlas', due_date: '2026-02-01', status: 'OVERDUE' }] } }),
            item('GATE_PASS', { state: 'OPEN', summary: '1 gate pass still out', detail: { passes: [{ id: 9, going_to: 'Home', departure_date: '2026-02-28' }] } }),
          ],
          open_item_count: 3,
        }),
      })
      await renderWizard()

      expect(await screen.findByText('Tuition (2/2026): PKR 1,500')).toBeInTheDocument()
      expect(screen.getByText(/Atlas — due .* \(overdue\)/)).toBeInTheDocument()
      expect(screen.getByText(/Out to Home since/)).toBeInTheDocument()
    })

    it('waives an item with a reason, showing who and why, and can undo it', async () => {
      mockApi({ existing: openCase() })
      const { user } = await renderWizard()
      const fees = within(await screen.findByTestId('item-FEES'))

      await user.click(fees.getByRole('button', { name: 'Waive…' }))
      await user.type(fees.getByLabelText(/Reason for waiving/), 'Fee concession approved by the board')
      await user.click(fees.getByRole('button', { name: 'Confirm waiver' }))

      expect(await fees.findByText(/Waived by admin on .*: Fee concession approved by the board/)).toBeInTheDocument()
      expect(calls).toContainEqual(['waive', 'FEES', 'Fee concession approved by the board'])

      await user.click(fees.getByRole('button', { name: 'Undo waiver' }))
      expect(await fees.findByRole('button', { name: 'Waive…' })).toBeInTheDocument()
    })

    it('shows the server message when the waiver reason is too short', async () => {
      mockApi({ existing: openCase() })
      const { user } = await renderWizard()
      const fees = within(await screen.findByTestId('item-FEES'))

      await user.click(fees.getByRole('button', { name: 'Waive…' }))
      await user.type(fees.getByLabelText(/Reason for waiving/), 'no')
      await user.click(fees.getByRole('button', { name: 'Confirm waiver' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('at least 10 characters')
    })

    it('refreshes the checklist on request', async () => {
      mockApi({ existing: openCase() })
      const { user } = await renderWizard()
      await screen.findByTestId('item-FEES')

      await user.click(screen.getByRole('button', { name: 'Refresh' }))

      await waitFor(() => expect(calls).toContainEqual(['refresh']))
    })

    it('blocks finalizing while an item is open, then finalizes after a waiver', async () => {
      mockApi({ existing: openCase() })
      const { user, onClose } = await renderWizard()
      await screen.findByTestId('item-FEES')

      await user.click(screen.getByRole('button', { name: 'Review' }))
      expect(screen.getByRole('button', { name: 'Finalize exit' })).toBeDisabled()
      expect(screen.getByText(/1 item is still open/)).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Back' }))
      const feesAgain = within(await screen.findByTestId('item-FEES'))
      await user.click(feesAgain.getByRole('button', { name: 'Waive…' }))
      await user.type(feesAgain.getByLabelText(/Reason for waiving/), 'Fee concession approved by the board')
      await user.click(feesAgain.getByRole('button', { name: 'Confirm waiver' }))
      await feesAgain.findByText(/Waived by admin/)

      await user.click(screen.getByRole('button', { name: 'Review' }))
      expect(screen.getByText(/Fee concession approved by the board/)).toBeInTheDocument()
      expect(screen.getByText(/Parents keep read-only access/)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Finalize exit' }))

      await waitFor(() => expect(calls).toContainEqual(['finalize']))
      await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith('Ali Hassan has been withdrawn.'))
      expect(onClose).toHaveBeenCalled()
    })

    it('shows why the server refused to finalize', async () => {
      mockApi({ existing: makeExit({ items: [item('FEES')], open_item_count: 0 }) })
      server.use(http.post('/api/student-exits/:id/finalize/', () =>
        HttpResponse.json({ code: 'clearance_incomplete', detail: 'Clear or waive every open item before finalizing: pending fees.' }, { status: 400 })))
      const { user } = await renderWizard()
      await screen.findByTestId('item-FEES')

      await user.click(screen.getByRole('button', { name: 'Review' }))
      await user.click(screen.getByRole('button', { name: 'Finalize exit' }))

      expect(await screen.findByText(/Clear or waive every open item/)).toBeInTheDocument()
    })

    it('cancels the exit with a reason and leaves the student unchanged', async () => {
      mockApi({ existing: openCase() })
      const { user, onClose } = await renderWizard()
      await screen.findByTestId('item-FEES')

      await user.click(screen.getByRole('button', { name: 'Cancel this exit' }))
      await user.type(screen.getByLabelText(/Why is this exit being cancelled/), 'Family stayed')
      await user.click(screen.getByRole('button', { name: 'Cancel exit' }))

      await waitFor(() => expect(calls).toContainEqual(['cancel', 'Family stayed']))
      expect(mockShowSuccess).toHaveBeenCalledWith('Exit cancelled. The student is unchanged.')
      expect(onClose).toHaveBeenCalled()
    })

    it('closing keeps the exit open for later', async () => {
      mockApi({ existing: openCase() })
      const { user, onClose } = await renderWizard()
      await screen.findByTestId('item-FEES')

      await user.click(screen.getByRole('button', { name: 'Close' }))

      expect(onClose).toHaveBeenCalled()
      expect(calls.some(([name]) => name === 'cancel')).toBe(false)
    })

    it('updates the details of an open exit when going back and continuing', async () => {
      mockApi({ existing: openCase() })
      const { user } = await renderWizard()
      await screen.findByTestId('item-FEES')

      await user.click(screen.getByRole('button', { name: 'Back' }))
      const reason = screen.getByLabelText('Reason')
      await user.clear(reason)
      await user.type(reason, 'Moved city')
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      await screen.findByTestId('item-FEES')
      expect(calls.find(([name]) => name === 'update')[1]).toMatchObject({ reason: 'Moved city' })
    })
  })
})
