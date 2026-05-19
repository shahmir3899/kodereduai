import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
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
  question_text: 'Sample question text',
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
  is_ai_generated: false,
  verified_by: null,
}

describe('Bloom Level UI', () => {
  beforeEach(() => {
    questionRows = [{ ...baseQuestion }]

    mockGetQuestions.mockImplementation((params = {}) => {
      const rows = questionRows.filter((q) => {
        if (params.bloom_level && q.bloom_level !== params.bloom_level) return false
        return true
      })
      return Promise.resolve({ data: { count: rows.length, results: rows } })
    })

    mockUpdateQuestion.mockImplementation((id, payload) => {
      questionRows = questionRows.map((q) => (q.id === id ? { ...q, ...payload } : q))
      return Promise.resolve({ data: { id, ...payload } })
    })

    mockGetBooksForClassSubject.mockResolvedValue({
      data: [{ id: 1, title: 'Math Book' }],
    })
    mockGetBookTree.mockResolvedValue({
      data: {
        chapters: [
          { id: 10, chapter_number: 1, title: 'Algebra', topics: [{ id: 100, name: 'Variables', title: 'Variables' }] },
        ],
      },
    })
    mockGetTags.mockResolvedValue({ data: [] })
    mockGetContentBlock.mockResolvedValue({ data: { id: 501, content_text: 'Source', topic_title: 'Variables' } })
    mockGetContentBlocks.mockResolvedValue({ data: { count: 1, results: [{ id: 501, block_type: 'text', content_text: 'Source block text' }] } })
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

  it('bloom_level select appears in add question modal', async () => {
    const user = await renderAndSelectClass()

    await user.click(screen.getByRole('button', { name: '+ Add Question' }))

    await waitFor(() => {
      expect(screen.getByText("Bloom's Level")).toBeInTheDocument()
    })
  })

  it('bloom badge renders on question card when set', async () => {
    questionRows = [{ ...baseQuestion, id: 2, bloom_level: 'apply', question_text: 'Apply level question' }]

    await renderAndSelectClass()

    await waitFor(() => {
      const applyBadge = screen.getByText('Apply', { selector: 'span' })
      expect(applyBadge).toBeInTheDocument()
      expect(applyBadge.className).toContain('bg-green-100')
    })
  })

  it('no bloom badge rendered when bloom_level is null', async () => {
    questionRows = [{ ...baseQuestion, id: 3, bloom_level: null, question_text: 'No bloom question' }]

    await renderAndSelectClass()

    await waitFor(() => {
      expect(screen.getByText('No bloom question')).toBeInTheDocument()
    })
    expect(screen.queryByText('Apply', { selector: 'span' })).not.toBeInTheDocument()
    expect(screen.queryByText('Analyze', { selector: 'span' })).not.toBeInTheDocument()
  })

  it('bloom level filter updates question list', async () => {
    questionRows = [
      { ...baseQuestion, id: 11, bloom_level: 'apply', question_text: 'Apply question' },
      { ...baseQuestion, id: 12, bloom_level: 'evaluate', question_text: 'Evaluate question' },
    ]

    const user = await renderAndSelectClass()

    const bloomFilterLabel = screen.getByText('Bloom Level')
    const bloomFilterSelect = bloomFilterLabel.parentElement.querySelector('select')
    await user.selectOptions(bloomFilterSelect, 'apply')

    await waitFor(() => {
      const lastCallParams = mockGetQuestions.mock.calls.at(-1)[0]
      expect(lastCallParams.bloom_level).toBe('apply')
    })
  })

  it('clearing bloom filter resets list', async () => {
    const user = await renderAndSelectClass()

    const bloomFilterLabel = screen.getByText('Bloom Level')
    const bloomFilterSelect = bloomFilterLabel.parentElement.querySelector('select')

    await user.selectOptions(bloomFilterSelect, 'apply')
    await waitFor(() => {
      const lastCallParams = mockGetQuestions.mock.calls.at(-1)[0]
      expect(lastCallParams.bloom_level).toBe('apply')
    })

    await user.selectOptions(bloomFilterSelect, '')
    await waitFor(() => {
      const lastCallParams = mockGetQuestions.mock.calls.at(-1)[0]
      expect(lastCallParams.bloom_level).toBeUndefined()
    })
  })

  it('edit modal pre-populates bloom_level from existing question', async () => {
    questionRows = [{ ...baseQuestion, id: 4, bloom_level: 'analyze', question_text: 'Analyze level question' }]

    const user = await renderAndSelectClass()

    await waitFor(() => {
      expect(screen.getByText('Analyze level question')).toBeInTheDocument()
    })

    await user.click(screen.getByTitle('Edit'))

    await waitFor(() => {
      expect(screen.getByText('Edit Question')).toBeInTheDocument()
    })

    const bloomLabel = screen.getByText("Bloom's Level")
    const bloomSelect = bloomLabel.parentElement.querySelector('select')
    expect(within(bloomSelect).getByRole('option', { name: 'Analyze' }).selected).toBe(true)
  })
})
