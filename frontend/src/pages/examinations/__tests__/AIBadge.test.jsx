import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/utils'
import QuestionsPage from '../QuestionsPage'

const mockGetQuestions = vi.fn()
const mockUpdateQuestion = vi.fn()
const mockGetBooksForClassSubject = vi.fn()
const mockGetBookTree = vi.fn()
const mockGetTags = vi.fn()
const mockGetContentBlock = vi.fn()
const mockGetContentBlocks = vi.fn()

let questionRows = []

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 7, username: 'admin', role: 'SCHOOL_ADMIN' },
    isTeacher: false,
  }),
}))

vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({
    activeAcademicYear: { id: 1, name: '2025-2026' },
  }),
}))

vi.mock('../../../hooks/useSessionClasses', () => ({
  useSessionClasses: () => ({ sessionClasses: [{ id: 101, class_obj: 1 }] }),
}))

vi.mock('../../../hooks/useClassSubjects', () => ({
  useClassSubjects: () => ({
    subjects: [{ id: 1, name: 'Mathematics', code: 'MATH' }],
    isLoading: false,
  }),
}))

vi.mock('../../../hooks/useTeacherScopedClasses', () => ({
  default: () => ({ showAllOption: false, classOptions: [{ id: 1, name: 'Class 1A' }] }),
}))

vi.mock('../../../utils/classScope', () => ({
  getClassSelectorScope: () => 'master',
  getResolvedMasterClassId: (value) => value,
}))

vi.mock('../../../components/ClassSelector', () => ({
  default: function MockClassSelector({ value, onChange }) {
    return (
      <select aria-label="Class" value={value} onChange={onChange}>
        <option value="">Select...</option>
        <option value="1">Class 1A</option>
      </select>
    )
  },
}))

vi.mock('../../../services/api', () => ({
  questionPaperApi: {
    getQuestions: (...args) => mockGetQuestions(...args),
    semanticSearchQuestions: vi.fn().mockResolvedValue({ data: { results: [] } }),
    createQuestion: vi.fn().mockResolvedValue({ data: { id: 999 } }),
    updateQuestion: (...args) => mockUpdateQuestion(...args),
    deleteQuestion: vi.fn().mockResolvedValue({ data: {} }),
    addQuestionTag: vi.fn().mockResolvedValue({ data: {} }),
  },
  lmsApi: {
    getBooksForClassSubject: (...args) => mockGetBooksForClassSubject(...args),
    getBookTree: (...args) => mockGetBookTree(...args),
    getTags: (...args) => mockGetTags(...args),
    getContentBlock: (...args) => mockGetContentBlock(...args),
    getContentBlocks: (...args) => mockGetContentBlocks(...args),
    createTag: vi.fn().mockResolvedValue({ data: { id: 33, name: 'Tag' } }),
  },
}))

const baseQuestion = {
  id: 1,
  school: 1,
  subject: 1,
  subject_name: 'Mathematics',
  exam_type: null,
  question_text: 'AI test question',
  question_type: 'SHORT',
  difficulty_level: 'MEDIUM',
  bloom_level: null,
  marks: '2.00',
  option_a: '',
  option_b: '',
  option_c: '',
  option_d: '',
  correct_answer: '',
  answer_text: 'Sample answer',
  type_data: {},
  tested_topics: [],
  source_content_block: null,
  is_ai_generated: false,
  verified_by: null,
}

describe('AI Badge and Verification', () => {
  beforeEach(() => {
    questionRows = [{ ...baseQuestion }]

    mockGetQuestions.mockImplementation((params = {}) => {
      const rows = questionRows.filter((q) => {
        if (params.is_ai_generated === 'true' && !q.is_ai_generated) return false
        if (params.is_ai_generated === 'false' && q.is_ai_generated) return false
        if (params['verified_by__isnull'] === 'true' && q.verified_by) return false
        if (params['verified_by__isnull'] === 'false' && !q.verified_by) return false
        return true
      })
      return Promise.resolve({ data: { count: rows.length, results: rows } })
    })

    mockUpdateQuestion.mockImplementation((id, payload) => {
      questionRows = questionRows.map((q) => (q.id === id ? { ...q, ...payload } : q))
      return Promise.resolve({ data: { id, ...payload } })
    })

    mockGetBooksForClassSubject.mockResolvedValue({ data: [{ id: 1, title: 'Math Book' }] })
    mockGetBookTree.mockResolvedValue({ data: { chapters: [] } })
    mockGetTags.mockResolvedValue({ data: [] })
    mockGetContentBlock.mockResolvedValue({ data: { id: 777, content_text: 'Source block' } })
    mockGetContentBlocks.mockResolvedValue({ data: { count: 0, results: [] } })
  })

  const renderAndSelectClass = async () => {
    const user = userEvent.setup()
    renderWithProviders(<QuestionsPage />)
    await user.selectOptions(screen.getByLabelText('Class'), '1')
    await waitFor(() => {
      expect(mockGetQuestions).toHaveBeenCalled()
    })
    return user
  }

  it('amber badge shown for unverified AI question', async () => {
    questionRows = [{ ...baseQuestion, id: 2, is_ai_generated: true, verified_by: null }]

    await renderAndSelectClass()

    await waitFor(() => {
      const badge = screen.getByText('AI · Unverified')
      expect(badge).toBeInTheDocument()
      expect(badge.className).toContain('bg-amber-100')
    })
  })

  it('green badge shown for verified AI question', async () => {
    questionRows = [{ ...baseQuestion, id: 3, is_ai_generated: true, verified_by: 7 }]

    await renderAndSelectClass()

    await waitFor(() => {
      const badge = screen.getByText('AI · Verified')
      expect(badge).toBeInTheDocument()
      expect(badge.className).toContain('bg-green-100')
    })
  })

  it('no AI badge on human-created questions', async () => {
    questionRows = [{ ...baseQuestion, id: 4, is_ai_generated: false, verified_by: null }]

    await renderAndSelectClass()

    await waitFor(() => {
      expect(screen.getByText('AI test question')).toBeInTheDocument()
    })
    expect(screen.queryByText('AI · Unverified')).not.toBeInTheDocument()
    expect(screen.queryByText('AI · Verified')).not.toBeInTheDocument()
  })

  it('verify button visible only on unverified AI questions', async () => {
    questionRows = [
      { ...baseQuestion, id: 5, question_text: 'Unverified AI', is_ai_generated: true, verified_by: null },
      { ...baseQuestion, id: 6, question_text: 'Verified AI', is_ai_generated: true, verified_by: 1 },
      { ...baseQuestion, id: 7, question_text: 'Human', is_ai_generated: false, verified_by: null },
    ]

    await renderAndSelectClass()

    await waitFor(() => {
      expect(screen.getByText('Unverified AI')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Verify' })).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: 'Verify' }).length).toBe(1)
  })

  it('clicking verify calls PATCH and updates badge to green', async () => {
    questionRows = [{ ...baseQuestion, id: 8, is_ai_generated: true, verified_by: null }]

    const user = await renderAndSelectClass()

    await waitFor(() => {
      expect(screen.getByText('AI · Unverified')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Verify' }))

    await waitFor(() => {
      expect(mockUpdateQuestion).toHaveBeenCalledTimes(1)
      const payload = mockUpdateQuestion.mock.calls[0][1]
      expect(payload.verified_by).toBe(7)
      expect(payload.verified_at).toBeTruthy()
    })

    await waitFor(() => {
      expect(screen.getByText('AI · Verified')).toBeInTheDocument()
    })
  })

  it('source filter options work correctly', async () => {
    questionRows = [{ ...baseQuestion, id: 9, is_ai_generated: true, verified_by: null }]

    const user = await renderAndSelectClass()

    const sourceFilterLabel = screen.getByText('Source')
    const sourceSelect = sourceFilterLabel.parentElement.querySelector('select')
    await user.selectOptions(sourceSelect, 'AI_UNVERIFIED')

    await waitFor(() => {
      const lastCallParams = mockGetQuestions.mock.calls.at(-1)[0]
      expect(lastCallParams.is_ai_generated).toBe('true')
      expect(lastCallParams['verified_by__isnull']).toBe('true')
    })
  })
})
