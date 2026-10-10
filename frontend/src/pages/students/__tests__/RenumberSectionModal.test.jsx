import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import RenumberSectionModal from '../components/RenumberSectionModal'

const mockShowSuccess = vi.fn()
vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: vi.fn(), showWarning: vi.fn() }),
}))

const section = { id: 11, label: 'Class 1 - A' }
const plan = [
  { enrollment_id: 1, student_id: 1, name: 'Abe', old_roll: '4', new_roll: '1' },
  { enrollment_id: 2, student_id: 2, name: 'Bea', old_roll: '2', new_roll: '2' },
  { enrollment_id: 3, student_id: 3, name: 'Cal', old_roll: '9', new_roll: '3' },
]

describe('RenumberSectionModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('previews only the students whose number changes, then applies the same order', async () => {
    const calls = []
    server.use(http.post('/api/sessions/session-classes/11/renumber/', async ({ request }) => {
      const body = await request.json()
      calls.push(body)
      if (body.action === 'apply') return HttpResponse.json({ section: 'Class 1 - A', changed: 2, changes: plan })
      return HttpResponse.json({ section: 'Class 1 - A', changes: plan, unchanged: 1, attendance_records: 5 })
    }))
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<RenumberSectionModal section={section} onClose={onClose} />)

    expect(await screen.findByText('Abe')).toBeInTheDocument()
    expect(screen.getByText('Cal')).toBeInTheDocument()
    expect(screen.queryByText('Bea')).not.toBeInTheDocument()
    expect(screen.getByText(/1 student\(s\) keep their number/)).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('5 attendance record(s)')

    await user.selectOptions(screen.getByLabelText('Order'), 'roll')
    await waitFor(() => expect(calls.at(-1)).toEqual({ action: 'preview', order: 'roll' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply new numbers' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Apply new numbers' }))

    // The dialog refreshes its preview after applying, so the apply is not the last call.
    await waitFor(() => expect(calls.find((c) => c.action === 'apply')).toEqual({ action: 'apply', order: 'roll' }))
    await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith('Re-numbered 2 students'))
    expect(onClose).toHaveBeenCalled()
  })

  it('numbers students in the order the admin sets, and sends that order', async () => {
    const roll = [
      { enrollment_id: 1, student_id: 1, name: 'Abe', old_roll: '1', new_roll: '1' },
      { enrollment_id: 2, student_id: 2, name: 'Bea', old_roll: '2', new_roll: '2' },
      { enrollment_id: 3, student_id: 3, name: 'Cal', old_roll: '3', new_roll: '3' },
    ]
    const calls = []
    server.use(http.post('/api/sessions/session-classes/11/renumber/', async ({ request }) => {
      const body = await request.json()
      calls.push(body)
      if (body.action === 'apply') return HttpResponse.json({ section: 'Class 1 - A', changed: 3, changes: roll })
      return HttpResponse.json({ section: 'Class 1 - A', changes: roll, unchanged: 3, attendance_records: 0 })
    }))
    const user = userEvent.setup()
    renderWithProviders(<RenumberSectionModal section={section} onClose={() => {}} />)

    await screen.findByText(/Nothing would change/)
    await user.selectOptions(screen.getByLabelText('Order'), 'manual')
    const list = await screen.findByRole('list', { name: 'Student order' })
    expect(list).toHaveTextContent('Abe')

    await user.click(screen.getByRole('button', { name: 'Move Cal up' }))
    await user.click(screen.getByRole('button', { name: 'Move Cal up' }))
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Cal')
    expect(items[0]).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: 'Move Cal up' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Apply new numbers' }))
    await waitFor(() => expect(calls.find((c) => c.action === 'apply')).toEqual({
      action: 'apply', order: 'manual', student_ids: [3, 1, 2],
    }))
  })

  it('has nothing to apply when every number already matches', async () => {
    server.use(http.post('/api/sessions/session-classes/11/renumber/', () => HttpResponse.json({
      section: 'Class 1 - A', changes: [plan[1]], unchanged: 1, attendance_records: 0,
    })))
    renderWithProviders(<RenumberSectionModal section={section} onClose={() => {}} />)

    expect(await screen.findByText(/Nothing would change/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply new numbers' })).toBeDisabled()
  })
})
