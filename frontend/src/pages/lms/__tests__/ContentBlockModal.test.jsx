import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/utils'
import CurriculumPage from '../CurriculumPage'

const mockGetClassSubjectsByClass = vi.fn()
const mockGetBooks = vi.fn()
const mockGetBookTree = vi.fn()
const mockGetSyllabusProgress = vi.fn()
const mockGetContentBlocks = vi.fn()
const mockGetTags = vi.fn()
const mockCreateContentBlock = vi.fn()
const mockUpdateContentBlock = vi.fn()
const mockDeleteContentBlock = vi.fn()
const mockConfirm = vi.fn()
const mockShowSuccess = vi.fn()
const mockShowError = vi.fn()

let blocksByTopic

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
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
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
    createContentBlock: (...args) => mockCreateContentBlock(...args),
    updateContentBlock: (...args) => mockUpdateContentBlock(...args),
    deleteContentBlock: (...args) => mockDeleteContentBlock(...args),
    semanticSearchContentBlocks: vi.fn().mockResolvedValue({ data: [] }),
    getContentBlockRevisions: vi.fn().mockResolvedValue({ data: [] }),
    addContentBlockTag: vi.fn().mockResolvedValue({ data: {} }),
    restoreContentBlockRevision: vi.fn().mockResolvedValue({ data: {} }),
    updateBook: vi.fn().mockResolvedValue({ data: {} }),
    deleteBook: vi.fn().mockResolvedValue({ data: {} }),
    createChapter: vi.fn().mockResolvedValue({ data: {} }),
    updateChapter: vi.fn().mockResolvedValue({ data: {} }),
    deleteChapter: vi.fn().mockResolvedValue({ data: {} }),
    createTopic: vi.fn().mockResolvedValue({ data: {} }),
    updateTopic: vi.fn().mockResolvedValue({ data: {} }),
    deleteTopic: vi.fn().mockResolvedValue({ data: {} }),
    updateSubtopic: vi.fn().mockResolvedValue({ data: {} }),
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

const setupBlocksApi = () => {
  mockGetContentBlocks.mockImplementation(({ topic_id }) => {
    const rows = blocksByTopic[topic_id] || []
    return Promise.resolve({ data: { count: rows.length, results: rows } })
  })
}

const renderReadyPage = async () => {
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

  await user.click(screen.getByRole('button', { name: /Content Blocks/ }))

  return user
}

describe('ContentBlock Modal', () => {
  beforeEach(() => {
    blocksByTopic = { 101: [] }
    mockConfirm.mockResolvedValue(true)

    mockGetClassSubjectsByClass.mockResolvedValue({
      data: { results: [{ id: 1, subject: 1, subject_name: 'Mathematics' }] },
    })
    mockGetBooks.mockResolvedValue({
      data: { results: [{ id: 1, title: 'Mathematics Textbook', chapter_count: 1 }] },
    })
    mockGetBookTree.mockResolvedValue({ data: bookTree })
    mockGetSyllabusProgress.mockResolvedValue({ data: {} })
    mockGetTags.mockResolvedValue({ data: { results: [] } })

    mockCreateContentBlock.mockImplementation((payload) => {
      const next = { id: Date.now(), ...payload }
      blocksByTopic[payload.topic] = [...(blocksByTopic[payload.topic] || []), next]
      return Promise.resolve({ data: next })
    })
    mockUpdateContentBlock.mockImplementation((id, { content_text }) => {
      Object.keys(blocksByTopic).forEach((topicId) => {
        blocksByTopic[topicId] = blocksByTopic[topicId].map((row) => (
          row.id === id ? { ...row, content_text } : row
        ))
      })
      return Promise.resolve({ data: { id, content_text } })
    })
    mockDeleteContentBlock.mockImplementation((id) => {
      Object.keys(blocksByTopic).forEach((topicId) => {
        blocksByTopic[topicId] = blocksByTopic[topicId].filter((row) => row.id !== id)
      })
      return Promise.resolve({ data: {} })
    })

    setupBlocksApi()
    mockShowSuccess.mockReset()
    mockShowError.mockReset()
  })

  it('opens add modal with empty fields when Add button clicked', async () => {
    const user = await renderReadyPage()

    await waitFor(() => {
      expect(screen.getByText('No content blocks yet. Add the first one.')).toBeInTheDocument()
    })

    await user.click(screen.getAllByRole('button', { name: 'Add Content Block' })[0])

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Add Content Block' })).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Write the content block text...')).toHaveValue('')
    })
  })

  it('opens edit modal pre-populated with existing block data', async () => {
    blocksByTopic = {
      101: [
        { id: 500, topic: 101, block_type: 'definition', content_text: 'Existing block', sequence_order: 1 },
      ],
    }
    setupBlocksApi()

    const user = await renderReadyPage()

    await waitFor(() => {
      expect(screen.getByText('Existing block')).toBeInTheDocument()
    })

    await user.click(screen.getByTitle('Edit content block'))

    await waitFor(() => {
      expect(screen.getByText('Edit Content Block')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Write the content block text...')).toHaveValue('Existing block')
    })
  })

  it('blocks form submission when block_type not selected', async () => {
    const user = await renderReadyPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Content Block' })).toBeInTheDocument()
    })

    await user.click(screen.getAllByRole('button', { name: 'Add Content Block' })[0])

    const blockTypeSelect = screen.getByText('Block Type *').parentElement.querySelector('select')
    fireEvent.change(blockTypeSelect, { target: { value: '' } })
    await user.type(screen.getByPlaceholderText('Write the content block text...'), 'Only text')
    const modal = screen.getByRole('heading', { name: 'Add Content Block' }).closest('.bg-white')
    await user.click(within(modal).getAllByRole('button', { name: 'Add Content Block' })[0])

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalled()
    })
    expect(mockCreateContentBlock).not.toHaveBeenCalled()
  })

  it('calls POST on create and invalidates query', async () => {
    const user = await renderReadyPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Content Block' })).toBeInTheDocument()
    })

    await user.click(screen.getAllByRole('button', { name: 'Add Content Block' })[0])
    await user.type(screen.getByPlaceholderText('Write the content block text...'), 'Newly created block')
    const modal = screen.getByRole('heading', { name: 'Add Content Block' }).closest('.bg-white')
    await user.click(within(modal).getAllByRole('button', { name: 'Add Content Block' })[0])

    await waitFor(() => {
      expect(mockCreateContentBlock).toHaveBeenCalledTimes(1)
    })
    expect(mockCreateContentBlock.mock.calls[0][0]).toMatchObject({
      topic: 101,
      content_text: 'Newly created block',
    })
  })

  it('calls PATCH on edit and shows success toast', async () => {
    blocksByTopic = {
      101: [
        { id: 700, topic: 101, block_type: 'text', content_text: 'Old text', sequence_order: 1 },
      ],
    }
    setupBlocksApi()

    const user = await renderReadyPage()

    await waitFor(() => expect(screen.getByText('Old text')).toBeInTheDocument())

    await user.click(screen.getByTitle('Edit content block'))

    const textArea = screen.getByPlaceholderText('Write the content block text...')
    await user.clear(textArea)
    await user.type(textArea, 'Updated text')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => {
      expect(mockUpdateContentBlock).toHaveBeenCalledTimes(1)
      expect(mockShowSuccess).toHaveBeenCalledWith('Content block updated')
    })
  })

  it('delete shows confirmation dialog then calls DELETE', async () => {
    blocksByTopic = {
      101: [
        { id: 900, topic: 101, block_type: 'text', content_text: 'To delete', sequence_order: 1 },
      ],
    }
    setupBlocksApi()

    const user = await renderReadyPage()

    await waitFor(() => expect(screen.getByText('To delete')).toBeInTheDocument())

    await user.click(screen.getByTitle('Delete content block'))

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledTimes(1)
      expect(mockDeleteContentBlock).toHaveBeenCalledTimes(1)
      expect(mockDeleteContentBlock).toHaveBeenCalledWith(900)
    })
  })
})
