import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../../test/utils'
import { ToastProvider } from '../../../components/Toast'
import StudentResponsePage from '../StudentResponsePage'

const submit = vi.fn()

vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useParams: () => ({ paperId: '7' }),
}))
vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ activeAcademicYear: { id: 1 } }),
}))
vi.mock('../../../services/api', () => ({
  questionPaperApi: {
    getExamPaper: () => Promise.resolve({ data: {
      id: 7, class_obj: 3,
      paper_questions: [{ id: 1, question: 11, question_type: 'MCQ', question_text: 'Pick the noun', marks: 5, correct_answer: 'A', options: { A: 'Table', B: 'Run' } }],
    } }),
    getStudentResponses: () => Promise.resolve({ data: { results: [] } }),
    submitStudentResponses: (...a) => submit(...a),
  },
  studentsApi: {
    getStudents: () => Promise.resolve({ data: { results: [{ id: 21, name: 'Sara Khan' }] } }),
  },
}))

// The page once imported the default export of components/Toast (the provider), so no
// "saved" message ever appeared; it must go through the useToast hook.
describe('StudentResponsePage toast', () => {
  it('shows a message when responses are saved', async () => {
    submit.mockResolvedValue({ data: { created_count: 1, updated_count: 0 } })
    renderWithProviders(<ToastProvider><StudentResponsePage /></ToastProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Correct' }, { timeout: 5000 }))
    fireEvent.click(await screen.findByRole('button', { name: 'Submit Responses' }, { timeout: 5000 }))
    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(await screen.findByText('Saved responses: 1 created, 0 updated.')).toBeInTheDocument()
  })
})
