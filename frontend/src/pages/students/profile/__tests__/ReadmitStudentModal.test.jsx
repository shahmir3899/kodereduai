import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../../test/mocks/server'
import { renderWithProviders } from '../../../../test/utils'
import ReadmitStudentModal from '../ReadmitStudentModal'

const mockShowSuccess = vi.fn()
vi.mock('../../../../components/Toast', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: vi.fn(), showWarning: vi.fn() }),
}))
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'SCHOOL_ADMIN' }, activeSchool: { id: 1, name: 'Test School' } }),
}))
vi.mock('../../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ activeAcademicYear: { id: 1, name: '2025-2026' } }),
}))

const student = {
  id: 5, name: 'Ali Hassan', status: 'WITHDRAWN', status_date: '2026-03-01',
  away_periods: [{ start: '2026-03-01', end: null, reason: '' }],
}

let posted
function mockReadmit(respond) {
  posted = null
  server.use(http.post('/api/student-exits/readmit/', async ({ request }) => {
    posted = await request.json()
    return respond ? respond(posted) : HttpResponse.json({ student: 5, status: 'ACTIVE', break: {} })
  }))
}

async function renderModal(props = {}) {
  const onClose = vi.fn()
  const user = userEvent.setup()
  renderWithProviders(<ReadmitStudentModal student={student} onClose={onClose} {...props} />)
  await screen.findByRole('heading', { name: 'Re-admit student' })
  return { user, onClose }
}

describe('ReadmitStudentModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('says since when the student has been away and that their records stay', async () => {
    mockReadmit()
    await renderModal()

    expect(screen.getByText(/Ali Hassan has been away since/)).toBeInTheDocument()
    expect(screen.getByText(/the time away stays empty/)).toBeInTheDocument()
  })

  it('falls back to the date on the record when no break is listed', async () => {
    mockReadmit()
    await renderModal({ student: { ...student, away_periods: [] } })

    expect(screen.getByText(/has been away since/)).toBeInTheDocument()
  })

  it('uses the details carried over from the status dialog', async () => {
    mockReadmit()
    await renderModal({ prefill: { return_date: '2026-03-20', reason: 'Back home' } })

    expect(screen.getByLabelText('Return date')).toHaveValue('2026-03-20')
    expect(screen.getByLabelText('Reason')).toHaveValue('Back home')
  })

  it('re-admits into the same class when none is chosen, then closes', async () => {
    mockReadmit()
    const { user, onClose } = await renderModal({ prefill: { return_date: '2026-03-20', reason: '' } })

    await user.type(screen.getByLabelText('Reason'), 'Returned home')
    await user.click(screen.getByRole('button', { name: 'Re-admit student' }))

    await waitFor(() => expect(posted).not.toBeNull())
    expect(posted).toEqual({
      student: 5, return_date: '2026-03-20', session_class: null, roll_number: '', reason: 'Returned home',
    })
    await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith('Ali Hassan has been re-admitted.'))
    expect(onClose).toHaveBeenCalled()
  })

  it('allows a return date in the future', async () => {
    mockReadmit()
    const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
    const { user } = await renderModal({ prefill: { return_date: future } })

    await user.click(screen.getByRole('button', { name: 'Re-admit student' }))

    await waitFor(() => expect(posted?.return_date).toBe(future))
  })

  it('sends the chosen class and the suggested next free roll', async () => {
    mockReadmit()
    const { user } = await renderModal({ prefill: { return_date: '2026-08-03' } })
    const classSelect = screen.getByLabelText('Class')
    await waitFor(() => expect(within(classSelect).getByText('Class 1A - A')).toBeInTheDocument())

    await user.selectOptions(classSelect, 'Class 1A - A')

    await waitFor(() => expect(screen.getByLabelText('Roll number')).toHaveValue('4'))
    await user.click(screen.getByRole('button', { name: 'Re-admit student' }))
    await waitFor(() => expect(posted).not.toBeNull())
    expect(posted).toMatchObject({ session_class: 1, roll_number: '4', return_date: '2026-08-03' })
  })

  it('keeps a roll number the admin typed when changing class', async () => {
    mockReadmit()
    const { user } = await renderModal()
    const classSelect = screen.getByLabelText('Class')
    await waitFor(() => expect(within(classSelect).getByText('Class 1A - A')).toBeInTheDocument())

    await user.type(screen.getByLabelText('Roll number'), '77')
    await user.selectOptions(classSelect, 'Class 1A - A')
    await user.click(screen.getByRole('button', { name: 'Re-admit student' }))

    await waitFor(() => expect(posted).not.toBeNull())
    expect(posted.roll_number).toBe('77')
  })

  it('shows the server message and stays open when it refuses', async () => {
    mockReadmit(() => HttpResponse.json(
      { detail: 'Choose a class and a roll number: Ali Hassan has no enrollment in 2026-2027 yet.' }, { status: 400 },
    ))
    const { user, onClose } = await renderModal()

    await user.click(screen.getByRole('button', { name: 'Re-admit student' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a class and a roll number')
    expect(onClose).not.toHaveBeenCalled()
    expect(mockShowSuccess).not.toHaveBeenCalled()
  })

  it('needs a return date', async () => {
    mockReadmit()
    const { user } = await renderModal()
    await user.clear(screen.getByLabelText('Return date'))

    await user.click(screen.getByRole('button', { name: 'Re-admit student' }))

    expect(screen.getByRole('alert')).toHaveTextContent('A return date is required.')
    expect(posted).toBeNull()
  })

  it('cancels without sending anything', async () => {
    mockReadmit()
    const { user, onClose } = await renderModal()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalled()
    expect(posted).toBeNull()
  })
})
