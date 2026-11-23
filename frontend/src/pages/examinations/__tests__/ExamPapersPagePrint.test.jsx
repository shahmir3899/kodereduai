import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/utils'
import ExamPapersPage from '../ExamPapersPage'

// Paper Builder v2 Phase 7: the server PDF is gone, so an OLD paper (made before the block editor, no block
// list) is printed on the device from print-html like a block paper. Word still comes from the server.

const mockPrintPaper = vi.fn(() => Promise.resolve())
const mockPrintAnswerKey = vi.fn(() => Promise.resolve())
vi.mock('../blocks/printPaper', () => ({
  printPaper: (...args) => mockPrintPaper(...args),
  printAnswerKey: (...args) => mockPrintAnswerKey(...args),
}))

const mockGenerateDOCX = vi.fn(() => Promise.resolve({ data: new Blob(['PK']) }))
vi.mock('../../../services/api', () => ({
  questionPaperApi: {
    getExamPapers: () => Promise.resolve({ data: { count: 1, results: [
      { id: 4, paper_title: 'Quick Quiz', status: 'DRAFT', uses_blocks: false, class_name: 'Class 1', subject_name: 'Maths', question_count: 10, total_marks: 10, made_by_name: 'Ayesha Khan' },
    ] } }),
    generateDOCX: (...args) => mockGenerateDOCX(...args),
    getExamPaperMakers: () => Promise.resolve({ data: [{ id: 7, name: 'Ayesha Khan' }] }),
  },
  lmsApi: { getMyLessonPlanClasses: () => Promise.resolve({ data: [] }) },
}))
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ effectiveRole: 'SCHOOL_ADMIN' }) }))
vi.mock('../../../contexts/AcademicYearContext', () => ({ useAcademicYear: () => ({ activeAcademicYear: { id: 1 } }) }))
vi.mock('../../../components/Toast', () => ({ useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn(), showWarning: vi.fn() }) }))
vi.mock('../../../hooks/useSessionClasses', () => ({ useSessionClasses: () => ({ sessionClasses: [] }) }))
vi.mock('../../../hooks/useClassSubjects', () => ({ useClassSubjects: () => ({ subjects: [], isLoading: false }) }))
vi.mock('../../../hooks/useTeacherScopedClasses', () => ({ default: () => ({ showAllOption: true, classOptions: [] }) }))
vi.mock('../../../hooks/useViewPreference', () => ({ useViewPreference: () => ['table', vi.fn()] }))
vi.mock('../../../components/ClassSelector', () => ({ default: () => null }))

describe('ExamPapersPage printing (Phase 7)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('prints an old paper on the device instead of asking the server for a PDF', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ExamPapersPage />)
    await screen.findAllByText('Quick Quiz')
    await user.click(screen.getAllByRole('button', { name: 'PDF' })[0])
    expect(mockPrintPaper).toHaveBeenCalledWith(4, 'Quick Quiz')
  })

  it('still downloads Word from the server', async () => {
    window.URL.createObjectURL = vi.fn(() => 'blob:x')
    window.URL.revokeObjectURL = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<ExamPapersPage />)
    await screen.findAllByText('Quick Quiz')
    await user.click(screen.getAllByRole('button', { name: 'DOCX' })[0])
    expect(mockGenerateDOCX).toHaveBeenCalledWith(4)
    expect(mockPrintPaper).not.toHaveBeenCalled()
  })

  it('prints the answer key on the device (step 7b)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ExamPapersPage />)
    await screen.findAllByText('Quick Quiz')
    await user.click(screen.getAllByRole('button', { name: 'Answer key' })[0])
    expect(mockPrintAnswerKey).toHaveBeenCalledWith(4, 'Quick Quiz')
    expect(mockPrintPaper).not.toHaveBeenCalled()
  })

  it('says who made each paper and offers the Made by filter to school-wide roles', async () => {
    renderWithProviders(<ExamPapersPage />)
    expect(await screen.findByText('Ayesha Khan', { selector: 'td' })).toBeInTheDocument()
    expect(screen.getByLabelText('Made by')).toBeInTheDocument()
    expect(screen.queryByText('Mine only')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })
})
