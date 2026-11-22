import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const createStudent = vi.fn()
const bulkCreateStudents = vi.fn()

vi.mock('../../../services/api', () => ({
  studentsApi: {
    getStudents: vi.fn().mockResolvedValue({ data: { results: [] } }),
    createStudent: (...a) => createStudent(...a),
    bulkCreateStudents: (...a) => bulkCreateStudents(...a),
  },
  sessionsApi: {
    getAcademicYears: vi.fn().mockResolvedValue({ data: { results: [{ id: 5, is_current: true }] } }),
    getSessionClasses: vi.fn().mockResolvedValue({
      data: { results: [
        { id: 11, class_obj: 3, display_name: 'Grade 1 A' },
        { id: 12, class_obj: 3, display_name: 'Grade 1 B' },
        { id: 21, class_obj: 4, display_name: 'Grade 2' },
      ] },
    }),
  },
}))
vi.mock('../../../hooks/useClasses', () => ({
  useClasses: () => ({ classes: [{ id: 3, name: 'Grade 1' }, { id: 4, name: 'Grade 2' }] }),
}))
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ activeSchool: { id: 42 } }) }))
vi.mock('../../../components/Toast', () => ({ useToast: () => ({ addToast: vi.fn() }) }))

import StudentsStep from '../StudentsStep'

const setup = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <StudentsStep onNext={vi.fn()} refetchCompletion={vi.fn()} />
  </QueryClientProvider>,
)

const byLabel = (re) => screen.getByText(re).parentElement.querySelector('input,select')

describe('StudentsStep setup wizard', () => {
  beforeEach(() => {
    createStudent.mockReset().mockResolvedValue({ data: {} })
    bulkCreateStudents.mockReset().mockResolvedValue({ data: { created_count: 1, updated_count: 0, errors: [] } })
  })

  it('Add One sends school, a single name and the chosen section', async () => {
    setup()
    fireEvent.click(await screen.findByText('+ Add One'))
    fireEvent.change(byLabel(/First Name/), { target: { value: 'Ahmed' } })
    fireEvent.change(byLabel(/Last Name/), { target: { value: 'Khan' } })
    fireEvent.change(byLabel(/^Class/), { target: { value: '3' } })
    fireEvent.change(await screen.findByDisplayValue('Select section'), { target: { value: '12' } })
    fireEvent.change(byLabel(/Roll Number/), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Student' }))
    await waitFor(() => expect(createStudent).toHaveBeenCalled())
    expect(createStudent.mock.calls[0][0]).toEqual({
      school: 42, class_obj: 3, session_class_id: 12, name: 'Ahmed Khan', roll_number: '7',
    })
  })

  it('Add One passes the only section automatically and blocks a missing roll number', async () => {
    setup()
    fireEvent.click(await screen.findByText('+ Add One'))
    fireEvent.change(byLabel(/First Name/), { target: { value: 'Sara' } })
    fireEvent.change(byLabel(/^Class/), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Student' }))
    expect(createStudent).not.toHaveBeenCalled()
    fireEvent.change(byLabel(/Roll Number/), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Student' }))
    await waitFor(() => expect(createStudent).toHaveBeenCalled())
    expect(createStudent.mock.calls[0][0]).toMatchObject({ school: 42, class_obj: 4, session_class_id: 21, name: 'Sara' })
  })

  it('Bulk Import sends the backend shape', async () => {
    setup()
    fireEvent.change(await screen.findByDisplayValue('All classes'), { target: { value: '4' } })
    fireEvent.click(screen.getByText('+ Bulk Import'))
    fireEvent.change(screen.getByPlaceholderText(/Ahmed Khan/), { target: { value: '1, Ahmed Khan' } })
    fireEvent.click(screen.getByText('Import Students'))
    await waitFor(() => expect(bulkCreateStudents).toHaveBeenCalled())
    expect(bulkCreateStudents.mock.calls[0][0]).toEqual({
      school_id: 42, class_id: 4, session_class_id: 21, students: [{ roll_number: '1', name: 'Ahmed Khan' }],
    })
  })
})
