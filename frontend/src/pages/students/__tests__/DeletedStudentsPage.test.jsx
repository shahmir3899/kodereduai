import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import DeletedStudentsPage from '../DeletedStudentsPage'

const mockShowSuccess = vi.fn()
const mockShowError = vi.fn()
vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError, showWarning: vi.fn() }),
}))

const row = {
  id: 9, name: 'Fresh Student', roll_number: '990', class_obj: 1, class_name: 'Class 1A',
  deleted_at: '2026-10-10T08:00:00Z', deleted_by: 'admin', deleted_reason: 'entered twice',
}

function useDeleted(preview) {
  server.use(
    http.get('/api/students/deleted/', () => HttpResponse.json({ count: 1, results: [row] })),
    http.get('/api/students/9/removal-preview/', () => HttpResponse.json(preview)),
  )
}

async function openPurge() {
  const user = userEvent.setup()
  renderWithProviders(<DeletedStudentsPage />)
  await user.click((await screen.findAllByRole('button', { name: 'Delete permanently' }))[0])
  return { user, dialog: within(await screen.findByRole('dialog')) }
}

describe('DeletedStudentsPage — delete permanently', () => {
  beforeEach(() => vi.clearAllMocks())

  it('erases a student with no records after the name is typed back', async () => {
    useDeleted({ has_history: false, can_purge: true, counts: {}, allowed_outcomes: [] })
    let body = null
    server.use(http.post('/api/students/9/purge/', async ({ request }) => {
      body = await request.json()
      return new HttpResponse(null, { status: 204 })
    }))
    const { user, dialog } = await openPurge()

    const confirm = await dialog.findByRole('button', { name: 'Delete permanently' })
    expect(confirm).toBeDisabled()
    await user.type(await dialog.findByLabelText(/Type "Fresh Student"/), 'fresh student')
    await user.click(confirm)

    await waitFor(() => expect(body).toEqual({ confirm_name: 'fresh student' }))
    await waitFor(() => expect(mockShowSuccess).toHaveBeenCalledWith('Fresh Student was erased permanently.'))
  })

  it('explains why a student with records cannot be erased and offers no confirm', async () => {
    useDeleted({ has_history: true, can_purge: false, counts: { attendance: 4 }, allowed_outcomes: [] })
    const { dialog } = await openPurge()

    expect(await dialog.findByText(/cannot be erased/)).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Delete permanently' })).toBeDisabled()
    expect(dialog.queryByLabelText(/Type "Fresh Student"/)).not.toBeInTheDocument()
  })
})
