import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/utils'
import CurriculumPage from '../CurriculumPage'

const mockGetClassSubjectsByClass = vi.fn()
const mockGetBooks = vi.fn()
const mockGetBookTree = vi.fn()
const mockGetSyllabusProgress = vi.fn()
const mockGetContentBlocks = vi.fn()
const mockGetTags = vi.fn()

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'admin', role: 'SCHOOL_ADMIN' },
    activeSchool: { id: 1, name: 'Test School', role: 'SCHOOL_ADMIN' },
    isTeacher: false,
  }),
}))

vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({
    activeAcademicYear: { id: 1, name: '2025-2026' },
  }),
}))

vi.mock('../../../hooks/useSessionClasses', () => ({
  useSessionClasses: () => ({
    sessionClasses: [{ id: 101, class_obj: 1 }],
  }),
}))

vi.mock('../../../hooks/useTeacherScopedClasses', () => ({
  default: () => ({
    showAllOption: false,
    classOptions: [{ id: 1, name: 'Class 1A' }],
  }),
}))

vi.mock('../../../utils/classScope', () => ({
  getClassSelectorScope: () => 'master',
  getResolvedMasterClassId: (value) => value,
}))

vi.mock('../../../components/ClassSelector', () => ({
  default: function MockClassSelector({ value, onChange }) {
    return (
      <select aria-label="Class" value={value} onChange={onChange}>
        <option value="">Select Class</option>
        <option value="1">Class 1A</option>
      </select>
    )
  },
}))

vi.mock('../../../components/SubjectSelector', () => ({
  default: function MockSubjectSelector({ value, onChange, subjects = [], disabled }) {
    return (
      <select aria-label="Subject" value={value} onChange={onChange} disabled={disabled}>
        <option value="">Select Subject</option>
        {subjects.map((subject) => (
          <option key={subject.id} value={subject.id}>{subject.name}</option>
        ))}
      </select>
    )
  },
}))

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}))

vi.mock('../../../components/ConfirmModal', () => ({
  useConfirmModal: () => ({
    confirm: vi.fn().mockResolvedValue(true),
    ConfirmModalRoot: () => null,
  }),
}))

vi.mock('../../../services/api', () => ({
  academicsApi: {
    getClassSubjectsByClass: (...args) => mockGetClassSubjectsByClass(...args),
  },
  lmsApi: {
    getBooks: (...args) => mockGetBooks(...args),
    getBookTree: (...args) => mockGetBookTree(...args),
    getSyllabusProgress: (...args) => mockGetSyllabusProgress(...args),
    getContentBlocks: (...args) => mockGetContentBlocks(...args),
    getTags: (...args) => mockGetTags(...args),
    semanticSearchContentBlocks: vi.fn().mockResolvedValue({ data: [] }),
    getContentBlockRevisions: vi.fn().mockResolvedValue({ data: [] }),
    updateBook: vi.fn().mockResolvedValue({ data: {} }),
    deleteBook: vi.fn().mockResolvedValue({ data: {} }),
    createChapter: vi.fn().mockResolvedValue({ data: {} }),
    updateChapter: vi.fn().mockResolvedValue({ data: {} }),
    deleteChapter: vi.fn().mockResolvedValue({ data: {} }),
    createTopic: vi.fn().mockResolvedValue({ data: {} }),
    updateTopic: vi.fn().mockResolvedValue({ data: {} }),
    deleteTopic: vi.fn().mockResolvedValue({ data: {} }),
    updateSubtopic: vi.fn().mockResolvedValue({ data: {} }),
    createContentBlock: vi.fn().mockResolvedValue({ data: {} }),
    updateContentBlock: vi.fn().mockResolvedValue({ data: {} }),
    deleteContentBlock: vi.fn().mockResolvedValue({ data: {} }),
    addContentBlockTag: vi.fn().mockResolvedValue({ data: {} }),
    restoreContentBlockRevision: vi.fn().mockResolvedValue({ data: {} }),
    parseTOC: vi.fn().mockResolvedValue({ data: { chapters: [] } }),
    parseTOCStream: vi.fn().mockResolvedValue({ data: { chapters: [] } }),
    applyTOC: vi.fn().mockResolvedValue({ data: {} }),
    suggestTOC: vi.fn().mockResolvedValue({ data: { chapters: [] } }),
  },
}))

const baseBookTree = {
  id: 1,
  title: 'Mathematics Textbook',
  chapters: [
    {
      id: 10,
      title: 'Algebra',
      chapter_number: 1,
      topics: [
        {
          id: 101,
          title: 'Variables',
          topic_number: 1,
          is_covered: false,
          is_tested: false,
          test_question_count: 0,
          estimated_periods: 2,
          subtopics: [],
        },
      ],
    },
  ],
}

describe('ContentBlock List View', () => {
  beforeEach(() => {
    mockGetClassSubjectsByClass.mockResolvedValue({
      data: { results: [{ id: 1, subject: 1, subject_name: 'Mathematics' }] },
    })
    mockGetBooks.mockResolvedValue({
      data: { results: [{ id: 1, title: 'Mathematics Textbook', chapter_count: 1 }] },
    })
    mockGetBookTree.mockResolvedValue({ data: baseBookTree })
    mockGetSyllabusProgress.mockResolvedValue({ data: {} })
    mockGetTags.mockResolvedValue({ data: { results: [] } })
    mockGetContentBlocks.mockResolvedValue({
      data: {
        count: 2,
        results: [
          { id: 1001, topic: 101, block_type: 'definition', content_text: 'A definition block', sequence_order: 1 },
          { id: 1002, topic: 101, block_type: 'example', content_text: 'A worked example block', sequence_order: 2 },
        ],
      },
    })
  })

  const selectFilters = async () => {
    const user = userEvent.setup()
    renderWithProviders(<CurriculumPage />)

    await user.selectOptions(screen.getByLabelText('Class'), '1')
    await waitFor(() => expect(screen.getByLabelText('Subject')).not.toBeDisabled())
    await user.selectOptions(screen.getByLabelText('Subject'), '1')

    await waitFor(() => {
      expect(screen.getByText('Mathematics Textbook')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Mathematics Textbook'))

    await waitFor(() => {
      expect(screen.getByText(/Algebra/)).toBeInTheDocument()
    })

    await user.click(screen.getByText(/Algebra/))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Content Blocks/ })).toBeInTheDocument()
    })

    return user
  }

  it('shows content block count on topic row', async () => {
    await selectFilters()
    expect(screen.getByRole('button', { name: 'Content Blocks (2)' })).toBeInTheDocument()
  })

  it('renders content block cards with correct badge colors', async () => {
    const user = await selectFilters()
    await user.click(screen.getByRole('button', { name: 'Content Blocks (2)' }))

    await waitFor(() => {
      const definitionBadge = screen.getByText('Definition')
      const exampleBadge = screen.getByText('Example')
      expect(definitionBadge.className).toContain('bg-blue-100')
      expect(exampleBadge.className).toContain('bg-green-100')
    })
  })

  it('shows loading skeleton while fetching', async () => {
    let resolveBlocks
    mockGetContentBlocks.mockImplementation(
      () => new Promise((resolve) => { resolveBlocks = resolve }),
    )

    const user = await selectFilters()
    await user.click(screen.getByRole('button', { name: /Content Blocks/ }))

    await waitFor(() => {
      expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    })

    resolveBlocks({ data: { count: 0, results: [] } })
  })

  it('shows empty state when no blocks exist', async () => {
    mockGetContentBlocks.mockResolvedValue({ data: { count: 0, results: [] } })

    const user = await selectFilters()
    await user.click(screen.getByRole('button', { name: /Content Blocks/ }))

    await waitFor(() => {
      expect(screen.getByText('No content blocks yet. Add the first one.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Add Content Block' })).toBeInTheDocument()
    })
  })

  it('collapses and hides blocks without refetching', async () => {
    const user = await selectFilters()
    const toggle = screen.getByRole('button', { name: /Content Blocks/ })

    await user.click(toggle)
    await waitFor(() => {
      expect(screen.getByText('A definition block')).toBeInTheDocument()
    })
    const callCountAfterExpand = mockGetContentBlocks.mock.calls.length

    await user.click(toggle)

    await waitFor(() => {
      expect(screen.queryByText('A definition block')).not.toBeInTheDocument()
    })
    expect(mockGetContentBlocks.mock.calls.length).toBe(callCountAfterExpand)
  })
})
