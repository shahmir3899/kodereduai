import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const bulkDeleteStudents = vi.fn()
vi.mock('../../../services/api', () => ({
  studentsApi: { bulkDeleteStudents: (...a) => bulkDeleteStudents(...a) },
}))

import BulkDeleteStudentsModal from '../components/BulkDeleteStudentsModal'

const people = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Student ${i + 1}`, roll_number: String(i + 1) }))

const open = (students, props = {}) => render(
  <QueryClientProvider client={new QueryClient()}>
    <BulkDeleteStudentsModal students={students} onDone={vi.fn()} onClose={vi.fn()} {...props} />
  </QueryClientProvider>,
)

describe('BulkDeleteStudentsModal', () => {
  beforeEach(() => bulkDeleteStudents.mockReset())

  it('needs the count typed back and a reason before Remove is enabled', async () => {
    const user = userEvent.setup()
    open(people(3))
    const remove = screen.getByRole('button', { name: 'Remove 3 student(s)' })
    expect(remove).toBeDisabled()
    await user.type(screen.getByLabelText('Type 3 to confirm'), '3')
    expect(remove).toBeDisabled() // reason still empty
    await user.type(screen.getByLabelText('Reason (required)'), 'test entries')
    expect(remove).toBeEnabled()
  })

  it('wrong count keeps Remove disabled', async () => {
    const user = userEvent.setup()
    open(people(3))
    await user.type(screen.getByLabelText('Type 3 to confirm'), '2')
    await user.type(screen.getByLabelText('Reason (required)'), 'x')
    expect(screen.getByRole('button', { name: 'Remove 3 student(s)' })).toBeDisabled()
  })

  it('sends 150 students as two batches of 100 and 50, then shows skipped ones', async () => {
    const user = userEvent.setup()
    bulkDeleteStudents
      .mockResolvedValueOnce({ data: { deleted: Array.from({ length: 100 }, (_, i) => i + 1), skipped: [] } })
      .mockResolvedValueOnce({ data: {
        deleted: Array.from({ length: 49 }, (_, i) => i + 101),
        skipped: [{ id: 150, name: 'Student 150', code: 'transfer_linked', detail: 'Part of a branch transfer.' }],
      } })
    const onDone = vi.fn()
    open(people(150), { onDone })
    await user.type(screen.getByLabelText('Type 150 to confirm'), '150')
    await user.type(screen.getByLabelText('Reason (required)'), 'test entries')
    await user.click(screen.getByRole('button', { name: 'Remove 150 student(s)' }))

    await waitFor(() => expect(bulkDeleteStudents).toHaveBeenCalledTimes(2))
    expect(bulkDeleteStudents.mock.calls[0][0].student_ids).toHaveLength(100)
    expect(bulkDeleteStudents.mock.calls[1][0]).toMatchObject({ reason: 'test entries' })
    expect(bulkDeleteStudents.mock.calls[1][0].student_ids).toHaveLength(50)
    expect(await screen.findByText(/1 could not be removed/)).toBeInTheDocument()
    expect(screen.getByText(/Student 150: Part of a branch transfer/)).toBeInTheDocument()
    expect(onDone).toHaveBeenCalled()
  })

  it('shows the server error and keeps the dialog open when nothing was removed', async () => {
    const user = userEvent.setup()
    bulkDeleteStudents.mockRejectedValueOnce({ response: { data: { detail: 'A reason is required.' } } })
    open(people(2))
    await user.type(screen.getByLabelText('Type 2 to confirm'), '2')
    await user.type(screen.getByLabelText('Reason (required)'), 'x')
    await user.click(screen.getByRole('button', { name: 'Remove 2 student(s)' }))
    expect(await screen.findByText('A reason is required.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove 2 student(s)' })).toBeEnabled()
  })
})
