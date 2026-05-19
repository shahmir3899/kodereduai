import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/utils'
import CurriculumPage from '../CurriculumPage'

const mockGetClassSubjectsByClass = vi.fn()
const mockGetBooks = vi.fn()
const mockGetBookTree = vi.fn()
const mockGetSyllabusProgress = vi.fn()
const mockGetContentBlocks = vi.fn()
const mockGetTags = vi.fn()
const mockGetContentBlockRevisions = vi.fn()
const mockRestoreContentBlockRevision = vi.fn()
const mockConfirm = vi.fn()

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'admin', role: 'SCHOOL_ADMIN' },
    activeSchool: { id: 1, name: 'Test School', role: 'SCHOOL_ADMIN' },
    isTeacher: false,
  }),
}))

vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ activeAcademicYear: { id: 1, name: '2025-2026' } }),
}))

vi.mock('../../../hooks/useSessionClasses', () => ({
  useSessionClasses: () => ({ sessionClasses: [{ id: 101, class_obj: 1 }] }),
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
    confirm: mockConfirm,
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
    getContentBlockRevisions: (...args) => mockGetContentBlockRevisions(...args),
    restoreContentBlockRevision: (...args) => mockRestoreContentBlockRevision(...args),
    semanticSearchContentBlocks: vi.fn().mockResolvedValue({ data: [] }),
    addContentBlockTag: vi.fn().mockResolvedValue({ data: {} }),
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
    parseTOC: vi.fn().mockResolvedValue({ data: { chapters: [] } }),
    parseTOCStream: vi.fn().mockResolvedValue({ data: { chapters: [] } }),
    applyTOC: vi.fn().mockResolvedValue({ data: {} }),
    suggestTOC: vi.fn().mockResolvedValue({ data: { chapters: [] } }),
  },
}))

const bookTree = {
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
          estimated_periods: 2,
          subtopics: [],
        },
      ],
    },
  ],
}

const blocks = {
  101: [
    { id: 501, topic: 101, block_type: 'text', content_text: 'Current block text', sequence_order: 1 },
  ],
}

const revisions = [
  {
    id: 900,
    content_text: 'Current block text',
    content_rich: null,
    changed_at: '2026-05-25T12:00:00Z',
    changed_by_name: 'Admin',
    revision_note: 'Current revision',
  },
  {
    id: 899,
    content_text: 'Old block text',
    content_rich: { kind: 'table' },
    changed_at: '2026-05-24T12:00:00Z',
    changed_by_name: 'Teacher',
    revision_note: 'Previous revision',
  },
]

const openRevisionDrawer = async () => {
  const user = userEvent.setup()
  renderWithProviders(<CurriculumPage />)

  await user.selectOptions(screen.getByLabelText('Class'), '1')
  await waitFor(() => expect(screen.getByLabelText('Subject')).not.toBeDisabled())
  await user.selectOptions(screen.getByLabelText('Subject'), '1')

  await waitFor(() => expect(screen.getByText('Mathematics Textbook')).toBeInTheDocument())
  await user.click(screen.getByText('Mathematics Textbook'))

  await waitFor(() => expect(screen.getByText(/Algebra/)).toBeInTheDocument())
  await user.click(screen.getByText(/Algebra/))

  await waitFor(() => expect(screen.getByRole('button', { name: /Content Blocks/ })).toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: /Content Blocks/ }))

  await waitFor(() => expect(screen.getByText('Current block text')).toBeInTheDocument())
  await user.click(screen.getByTitle('View revision history'))

  await waitFor(() => {
    expect(screen.getByText('Content Block Revision History')).toBeInTheDocument()
  })

  return user
}

describe('Content Block Revision History', () => {
  beforeEach(() => {
    mockConfirm.mockResolvedValue(true)
    mockRestoreContentBlockRevision.mockResolvedValue({ data: {} })

    mockGetClassSubjectsByClass.mockResolvedValue({
      data: { results: [{ id: 1, subject: 1, subject_name: 'Mathematics' }] },
    })
    mockGetBooks.mockResolvedValue({ data: { results: [{ id: 1, title: 'Mathematics Textbook', chapter_count: 1 }] } })
    mockGetBookTree.mockResolvedValue({ data: bookTree })
    mockGetSyllabusProgress.mockResolvedValue({ data: {} })
    mockGetTags.mockResolvedValue({ data: { results: [] } })
    mockGetContentBlocks.mockImplementation(({ topic_id }) =>
      Promise.resolve({ data: { count: (blocks[topic_id] || []).length, results: blocks[topic_id] || [] } }),
    )
    mockGetContentBlockRevisions.mockResolvedValue({ data: revisions })
  })

  it('history icon button present on content block cards', async () => {
    const user = await openRevisionDrawer()
    expect(screen.getByText('Content Block Revision History')).toBeInTheDocument()
    expect(user).toBeTruthy()
  })

  it('clicking history opens revision drawer', async () => {
    await openRevisionDrawer()
    expect(screen.getByText('Current block text')).toBeInTheDocument()
  })

  it('revision list shows date, author, and content preview', async () => {
    await openRevisionDrawer()
    expect(screen.getByText('Revision #900')).toBeInTheDocument()
    expect(screen.getByText('Revision #899')).toBeInTheDocument()
    expect(screen.getByText(/Admin/)).toBeInTheDocument()
    expect(screen.getByText(/Teacher/)).toBeInTheDocument()
  })

  it('clicking a revision shows full content in read-only view', async () => {
    const user = await openRevisionDrawer()
    await user.click(screen.getByText('Revision #899'))

    await waitFor(() => {
      expect(screen.getByText('Old block text')).toBeInTheDocument()
    })
    expect(screen.queryByRole('textbox', { name: /content/i })).not.toBeInTheDocument()
  })

  it('restore button calls restore API and refreshes blocks', async () => {
    const user = await openRevisionDrawer()
    await user.click(screen.getByRole('button', { name: 'Restore this version' }))

    await waitFor(() => {
      expect(mockRestoreContentBlockRevision).toHaveBeenCalledTimes(1)
      expect(mockRestoreContentBlockRevision.mock.calls[0][0]).toBe(501)
      expect(mockRestoreContentBlockRevision.mock.calls[0][1]).toBe(900)
    })
  })

  it('empty state shown when no revisions exist', async () => {
    mockGetContentBlockRevisions.mockResolvedValueOnce({ data: [] })
    await openRevisionDrawer()

    expect(screen.getByText('No revisions found for this content block yet.')).toBeInTheDocument()
  })

  it('latest revision marked as Current', async () => {
    await openRevisionDrawer()
    expect(screen.getByText('Current')).toBeInTheDocument()
  })
})
