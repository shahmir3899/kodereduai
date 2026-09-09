import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImageCapturePaperTab from '../ImageCapturePaperTab'
import { renderWithProviders } from '../../../test/utils'

// Skips real image compression -- calls success() synchronously with the original
// file so the component's onDrop pipeline runs without needing real image decoding
// in jsdom.
vi.mock('compressorjs', () => ({
  default: class MockCompressor {
    constructor(file, options) {
      options.success(file)
    }
  },
}))

// The real AuthContext/Toast both throw if used outside their real Providers, which
// renderWithProviders (test/utils.jsx) doesn't wrap here -- same pattern other
// examinations tests use (see BloomChart.test.jsx).
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeSchool: { id: 1 }, user: { id: 1, role: 'SCHOOL_ADMIN' } }),
}))

const mockShowError = vi.fn()
const mockShowSuccess = vi.fn()
vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showError: mockShowError, showSuccess: mockShowSuccess }),
}))

// Isolates this test from PaperStructureBuilder/QuestionSlotEditor's own internals
// (data fetching, rich editing UI) -- we only need to see how many accumulated
// rows/questions they were handed across pages.
vi.mock('../PaperStructureBuilder', () => ({
  default: function MockPaperStructureBuilder({ sections }) {
    return <div data-testid="structure-sections-count">{sections.length}</div>
  },
  calculateAllocatedMarks: (sections) => (sections || []).reduce((sum, s) => {
    if (s.type === 'divider') return sum
    return sum + (Number(s.slots_counted) || 0) * (Number(s.marks_per_question) || 0)
  }, 0),
  makeDefaultSection: (index, overrides = {}) => ({
    local_id: overrides.key || `sec_${index}`,
    key: overrides.key || `sec_${index}`,
    type: 'question_group',
    title: overrides.title,
    instruction: overrides.instruction || '',
    question_type: overrides.question_type || 'SHORT',
    slots_shown: overrides.slots_shown || 0,
    slots_counted: overrides.slots_counted || 0,
    marks_per_question: overrides.marks_per_question || 0,
  }),
}))

vi.mock('../QuestionSlotEditor', () => ({
  default: function MockQuestionSlotEditor({ draftData }) {
    return <div data-testid="questions-count">{draftData.questions.length}</div>
  },
}))

const mockUploadPaperImage = vi.fn()
const mockGetPaperUpload = vi.fn()

vi.mock('../../../services/api', () => ({
  questionPaperApi: {
    uploadPaperImage: (...args) => mockUploadPaperImage(...args),
    getPaperUpload: (...args) => mockGetPaperUpload(...args),
  },
}))

function makeExtractedUpload({ id, groupId, pageNumber, sectionTitle, questionCount, marksPerQuestion = 1, headerOverrides = {} }) {
  const questions = Array.from({ length: questionCount }, (_, i) => ({
    question_text: `Page ${pageNumber} Q${i + 1}`,
    question_type: 'MCQ',
    marks: marksPerQuestion,
    options: { A: 'a', B: 'b', C: 'c', D: 'd' },
  }))
  return {
    data: {
      id,
      group_id: groupId,
      page_number: pageNumber,
      status: 'EXTRACTED',
      error_message: '',
      ai_extracted_json: {
        header: { exam_title: 'Test Paper', detected_total_marks: 20, ...headerOverrides },
        sections: [
          {
            title: sectionTitle,
            instruction: null,
            question_type_guess: 'MCQ',
            marks_per_question: marksPerQuestion,
            shown_count: questionCount,
            counted_count: questionCount,
            questions,
          },
        ],
        questions,
        computed_total_marks: questionCount * marksPerQuestion,
      },
    },
  }
}

async function uploadAFile() {
  const user = userEvent.setup()
  const fileInput = document.querySelector('input[type="file"]')
  const file = new File(['fake-image-bytes'], 'paper.png', { type: 'image/png' })
  await user.upload(fileInput, file)
}

describe('ImageCapturePaperTab multi-page sequential capture', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Recovery snapshots are keyed by school/user id (fixed by the AuthContext mock
    // above), so they'd otherwise leak between tests in this file.
    localStorage.clear()
  })

  it('page 1 upload has no group_id; page 2 reuses the group_id returned from page 1', async () => {
    mockUploadPaperImage
      .mockResolvedValueOnce({ data: { id: 1, group_id: 'group-abc', page_number: 1 } })
      .mockResolvedValueOnce({ data: { id: 2, group_id: 'group-abc', page_number: 2 } })
    mockGetPaperUpload
      .mockResolvedValueOnce(makeExtractedUpload({ id: 1, groupId: 'group-abc', pageNumber: 1, sectionTitle: 'Section 1', questionCount: 5 }))
      .mockResolvedValueOnce(makeExtractedUpload({ id: 2, groupId: 'group-abc', pageNumber: 2, sectionTitle: 'Section 2', questionCount: 5 }))

    const onApplyPrefill = vi.fn()
    renderWithProviders(<ImageCapturePaperTab classId={1} subjectId={1} onApplyPrefill={onApplyPrefill} />)

    await uploadAFile()
    await waitFor(() => expect(screen.getByText('Page 1 ✓ 5 Qs')).toBeInTheDocument())

    // First call: no group_id argument (4th positional arg undefined).
    expect(mockUploadPaperImage.mock.calls[0][3]).toBeUndefined()

    await userEvent.click(screen.getByRole('button', { name: '+ Add Page' }))
    await uploadAFile()
    await waitFor(() => expect(screen.getByText('Page 2 ✓ 5 Qs')).toBeInTheDocument())

    // Second call: reuses the group_id from page 1's response.
    expect(mockUploadPaperImage.mock.calls[1][3]).toBe('group-abc')
  })

  it('accumulates structure/questions across pages instead of replacing them', async () => {
    mockUploadPaperImage
      .mockResolvedValueOnce({ data: { id: 1, group_id: 'group-abc', page_number: 1 } })
      .mockResolvedValueOnce({ data: { id: 2, group_id: 'group-abc', page_number: 2 } })
    mockGetPaperUpload
      .mockResolvedValueOnce(makeExtractedUpload({ id: 1, groupId: 'group-abc', pageNumber: 1, sectionTitle: 'Section 1', questionCount: 3 }))
      .mockResolvedValueOnce(makeExtractedUpload({ id: 2, groupId: 'group-abc', pageNumber: 2, sectionTitle: 'Section 2', questionCount: 4 }))

    renderWithProviders(<ImageCapturePaperTab classId={1} subjectId={1} onApplyPrefill={vi.fn()} />)

    await uploadAFile()
    await waitFor(() => expect(screen.getByTestId('structure-sections-count')).toHaveTextContent('1'))
    expect(screen.getByTestId('questions-count')).toHaveTextContent('3')

    await userEvent.click(screen.getByRole('button', { name: '+ Add Page' }))
    await uploadAFile()

    await waitFor(() => expect(screen.getByTestId('structure-sections-count')).toHaveTextContent('2'))
    expect(screen.getByTestId('questions-count')).toHaveTextContent('7')
  })

  it('marks-progress banner warns when captured marks are below the detected total', async () => {
    mockUploadPaperImage.mockResolvedValueOnce({ data: { id: 1, group_id: 'group-abc', page_number: 1 } })
    mockGetPaperUpload.mockResolvedValueOnce(
      makeExtractedUpload({ id: 1, groupId: 'group-abc', pageNumber: 1, sectionTitle: 'Section 1', questionCount: 5, headerOverrides: { detected_total_marks: 20 } }),
    )

    renderWithProviders(<ImageCapturePaperTab classId={1} subjectId={1} onApplyPrefill={vi.fn()} />)

    await uploadAFile()
    // 5 questions * 1 mark = 5 captured, vs detected 20 -> incomplete warning, non-blocking.
    await waitFor(() => expect(screen.getByText(/this paper may be incomplete/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Accept & continue' })).toBeEnabled()
  })

  it('marks-progress banner shows complete once captured marks equal the detected total', async () => {
    mockUploadPaperImage.mockResolvedValueOnce({ data: { id: 1, group_id: 'group-abc', page_number: 1 } })
    mockGetPaperUpload.mockResolvedValueOnce(
      makeExtractedUpload({ id: 1, groupId: 'group-abc', pageNumber: 1, sectionTitle: 'Section 1', questionCount: 5, marksPerQuestion: 4, headerOverrides: { detected_total_marks: 20 } }),
    )

    renderWithProviders(<ImageCapturePaperTab classId={1} subjectId={1} onApplyPrefill={vi.fn()} />)

    await uploadAFile()
    await waitFor(() => expect(screen.getByText(/looks complete/)).toBeInTheDocument())
  })

  it('accept passes every page\'s uploadId, not just the last page', async () => {
    mockUploadPaperImage
      .mockResolvedValueOnce({ data: { id: 1, group_id: 'group-abc', page_number: 1 } })
      .mockResolvedValueOnce({ data: { id: 2, group_id: 'group-abc', page_number: 2 } })
    mockGetPaperUpload
      .mockResolvedValueOnce(makeExtractedUpload({ id: 1, groupId: 'group-abc', pageNumber: 1, sectionTitle: 'Section 1', questionCount: 3 }))
      .mockResolvedValueOnce(makeExtractedUpload({ id: 2, groupId: 'group-abc', pageNumber: 2, sectionTitle: 'Section 2', questionCount: 4 }))

    const onApplyPrefill = vi.fn()
    renderWithProviders(<ImageCapturePaperTab classId={1} subjectId={1} onApplyPrefill={onApplyPrefill} />)

    await uploadAFile()
    await waitFor(() => expect(screen.getByText('Page 1 ✓ 3 Qs')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '+ Add Page' }))
    await uploadAFile()
    await waitFor(() => expect(screen.getByText('Page 2 ✓ 4 Qs')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Accept & continue' }))

    expect(onApplyPrefill).toHaveBeenCalledWith(expect.objectContaining({
      uploadIds: [1, 2],
    }))
  })

  describe('crash/reload recovery', () => {
    const RECOVERY_KEY = 'paper_builder_image_capture_recovery_1_1'

    it('restores an accumulated capture from localStorage on mount', async () => {
      localStorage.setItem(RECOVERY_KEY, JSON.stringify({
        groupId: 'group-abc',
        pages: [{ pageNumber: 1, uploadId: 1, status: 'extracted', questionCount: 3, marksThisPage: 3, errorMessage: '' }],
        reviewStructure: [{ local_id: 'sec_0', key: 'sec_0', type: 'question_group', title: 'Section 1', slots_shown: 3, slots_counted: 3, marks_per_question: 1 }],
        reviewDraft: { paper_title: 'Recovered Paper', instructions: '', total_marks: '3', duration_minutes: '60', questions: [{ local_id: 'q1', question_text: 'Q1' }] },
        detectedHeader: { exam_title: 'Recovered Paper' },
      }))

      renderWithProviders(<ImageCapturePaperTab classId={1} subjectId={1} onApplyPrefill={vi.fn()} />)

      await waitFor(() => expect(screen.getByText('Page 1 ✓ 3 Qs')).toBeInTheDocument())
      expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('Recovered'))
      // Nothing was uploaded to reach this state -- it came entirely from storage.
      expect(mockUploadPaperImage).not.toHaveBeenCalled()
    })

    it('does not restore anything when there is no prior capture', () => {
      renderWithProviders(<ImageCapturePaperTab classId={1} subjectId={1} onApplyPrefill={vi.fn()} />)

      expect(mockShowSuccess).not.toHaveBeenCalled()
      expect(screen.getByText('Upload Question Paper Image')).toBeInTheDocument()
    })

    it('saves the accumulated capture to localStorage as pages are extracted', async () => {
      mockUploadPaperImage.mockResolvedValueOnce({ data: { id: 1, group_id: 'group-abc', page_number: 1 } })
      mockGetPaperUpload.mockResolvedValueOnce(
        makeExtractedUpload({ id: 1, groupId: 'group-abc', pageNumber: 1, sectionTitle: 'Section 1', questionCount: 3 }),
      )

      renderWithProviders(<ImageCapturePaperTab classId={1} subjectId={1} onApplyPrefill={vi.fn()} />)
      await uploadAFile()
      await waitFor(() => expect(screen.getByText('Page 1 ✓ 3 Qs')).toBeInTheDocument())

      await waitFor(() => {
        const saved = JSON.parse(localStorage.getItem(RECOVERY_KEY) || 'null')
        expect(saved).not.toBeNull()
        expect(saved.pages).toHaveLength(1)
        expect(saved.groupId).toBe('group-abc')
      })
    })

    it('clears the saved capture once accepted', async () => {
      mockUploadPaperImage.mockResolvedValueOnce({ data: { id: 1, group_id: 'group-abc', page_number: 1 } })
      mockGetPaperUpload.mockResolvedValueOnce(
        makeExtractedUpload({ id: 1, groupId: 'group-abc', pageNumber: 1, sectionTitle: 'Section 1', questionCount: 3 }),
      )

      renderWithProviders(<ImageCapturePaperTab classId={1} subjectId={1} onApplyPrefill={vi.fn()} />)
      await uploadAFile()
      await waitFor(() => expect(screen.getByText('Page 1 ✓ 3 Qs')).toBeInTheDocument())
      await waitFor(() => expect(localStorage.getItem(RECOVERY_KEY)).not.toBeNull())

      await userEvent.click(screen.getByRole('button', { name: 'Accept & continue' }))

      expect(localStorage.getItem(RECOVERY_KEY)).toBeNull()
    })

    it('clears the saved capture on Start Over', async () => {
      mockUploadPaperImage.mockResolvedValueOnce({ data: { id: 1, group_id: 'group-abc', page_number: 1 } })
      mockGetPaperUpload.mockResolvedValueOnce(
        makeExtractedUpload({ id: 1, groupId: 'group-abc', pageNumber: 1, sectionTitle: 'Section 1', questionCount: 3 }),
      )

      renderWithProviders(<ImageCapturePaperTab classId={1} subjectId={1} onApplyPrefill={vi.fn()} />)
      await uploadAFile()
      await waitFor(() => expect(screen.getByText('Page 1 ✓ 3 Qs')).toBeInTheDocument())
      await waitFor(() => expect(localStorage.getItem(RECOVERY_KEY)).not.toBeNull())

      await userEvent.click(screen.getByRole('button', { name: 'Start Over' }))

      expect(localStorage.getItem(RECOVERY_KEY)).toBeNull()
    })
  })
})
