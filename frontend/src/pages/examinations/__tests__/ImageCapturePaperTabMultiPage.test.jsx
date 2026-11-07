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




const mockUploadPaperImage = vi.fn()
const mockGetPaperGroupStatus = vi.fn()

vi.mock('../../../services/api', () => ({
  questionPaperApi: {
    uploadPaperImage: (...args) => mockUploadPaperImage(...args),
    getPaperGroupStatus: (...args) => mockGetPaperGroupStatus(...args),
  },
}))

const section = (title, type, n, extra = {}) => ({
  title, instruction: null, question_type_guess: type, marks_per_question: 2, shown_count: n, counted_count: n,
  questions: Array.from({ length: n }, (_, i) => ({ question_text: `${title} question ${i + 1}`, question_type: type, marks: 2, options: null, type_data: null, ...extra })),
})

const status = (pages, result = null) => ({
  data: {
    group_id: 'g', total_pages: pages.length, pages, missing_pages: [], failed_pages: [], extra_pages: [],
    complete: pages.every((p) => p.status === 'EXTRACTED'), result,
  },
})
const pageRow = (n, s = 'EXTRACTED') => ({ page_number: n, upload_id: n, status: s, error_message: '' })

const result = {
  header: { exam_title: 'Mid Term', class_label: 'FIFTH', subject_label: 'SS', detected_total_marks: 8, duration_label: '90 minutes' },
  sections: [section('Objective', 'MCQ', 2), section('Short', 'SHORT', 2, { needs_review: true })],
  marks_check: { detected: 8, computed: 8, matches: true },
  low_confidence_count: 2,
}

async function chooseCount(user, n) {
  const input = screen.getByLabelText('Total pages')
  await user.clear(input)
  await user.type(input, String(n))
  await user.click(screen.getByRole('button', { name: 'Continue' }))
}

describe('ImageCapturePaperTab: declared page count, parallel upload, staged review', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('asks for the page count first and shows one slot per declared page', async () => {
    mockGetPaperGroupStatus.mockResolvedValue(status([pageRow(1, 'MISSING'), pageRow(2, 'MISSING'), pageRow(3, 'MISSING')]))
    const user = userEvent.setup()
    renderWithProviders(<ImageCapturePaperTab classId={1} subjectId={1} onApplyPrefill={vi.fn()} />)
    expect(screen.getByText('How many pages does the paper have?')).toBeInTheDocument()
    await chooseCount(user, 3)
    expect(await screen.findByLabelText('Page 3 image')).toBeInTheDocument()
    expect(await screen.findByText((_, el) => el?.tagName === 'P' && /^0 of 3 pages read/.test(el.textContent))).toBeInTheDocument()
  })

  it('uploads every page with the same client-made group id and its own page number, a few at a time', async () => {
    mockGetPaperGroupStatus.mockResolvedValue(status([pageRow(1, 'MISSING'), pageRow(2, 'MISSING'), pageRow(3, 'MISSING'), pageRow(4, 'MISSING')]))
    let release
    const gate = new Promise((resolve) => { release = resolve })
    mockUploadPaperImage.mockImplementation(() => gate.then(() => ({ data: {} })))
    const user = userEvent.setup()
    renderWithProviders(<ImageCapturePaperTab classId={5} subjectId={6} onApplyPrefill={vi.fn()} />)
    await chooseCount(user, 4)
    for (let n = 1; n <= 4; n += 1) {
      await user.upload(await screen.findByLabelText(`Page ${n} image`), new File(['x'], `p${n}.png`, { type: 'image/png' }))
    }
    // Four pages chosen, but only three uploads run at once.
    await waitFor(() => expect(mockUploadPaperImage).toHaveBeenCalledTimes(3))
    release()
    await waitFor(() => expect(mockUploadPaperImage).toHaveBeenCalledTimes(4))

    const calls = mockUploadPaperImage.mock.calls
    expect(new Set(calls.map((c) => c[3])).size).toBe(1)
    expect(calls[0][3]).toMatch(/^[0-9a-f-]{36}$/)
    expect(calls.map((c) => c[4]).sort()).toEqual([1, 2, 3, 4])
    expect(calls[0][1]).toBe(5)
    expect(calls[0][2]).toBe(6)
  })

  it('opens the review only after every declared page is read, questions first', async () => {
    mockGetPaperGroupStatus
      .mockResolvedValueOnce(status([pageRow(1), pageRow(2, 'PROCESSING')]))
      .mockResolvedValue(status([pageRow(1), pageRow(2)], result))
    localStorage.setItem('paper_builder_image_capture_1_1', JSON.stringify({ groupId: 'g', totalPages: 2 }))
    renderWithProviders(<ImageCapturePaperTab classId={1} subjectId={1} onApplyPrefill={vi.fn()} />)
    expect(await screen.findByText((_, el) => el?.tagName === 'P' && /^1 of 2 pages read/.test(el.textContent))).toBeInTheDocument()
    expect(screen.queryByText('1. Questions')).toBeNull()
    expect(await screen.findByText('1. Questions', {}, { timeout: 6000 })).toBeInTheDocument()
    expect(screen.getByText('Objective question 1')).toBeInTheDocument()
    expect(screen.getByText('Short question 1')).toBeInTheDocument()
    expect(screen.getAllByText('Check type')).toHaveLength(2)
  }, 15000)

  it('requires title and total marks, hands class/subject hints to the builder, and sends the types the user corrected', async () => {
    mockGetPaperGroupStatus.mockResolvedValue(status([pageRow(1)], {
      ...result, header: { ...result.header, exam_title: null, detected_total_marks: null }, sections: [section('Objective', 'MCQ', 2)],
    }))
    localStorage.setItem('paper_builder_image_capture_1_1', JSON.stringify({ groupId: 'g', totalPages: 1 }))
    const onApplyPrefill = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<ImageCapturePaperTab onApplyPrefill={onApplyPrefill} />)

    await screen.findByText('1. Questions')
    await user.selectOptions(screen.getByLabelText('Type of question 2'), 'TRUE_FALSE')
    await user.click(screen.getByRole('button', { name: '3. Details & accept' }))
    expect(screen.getByText(/Fill in before continuing: Paper title, Total marks/)).toBeInTheDocument()
    const accept = screen.getByRole('button', { name: 'Accept & continue' })
    expect(accept).toBeDisabled()

    await user.type(screen.getByLabelText('Paper title *'), 'Unit Test')
    await user.type(screen.getByLabelText('Total marks *'), '4')
    expect(accept).not.toBeDisabled()
    await user.click(accept)

    const prefill = onApplyPrefill.mock.calls[0][0]
    expect(prefill.paperFields.paper_title).toBe('Unit Test')
    expect(prefill.detected).toEqual({ class_label: 'FIFTH', subject_label: 'SS' })
    expect(prefill.structure).toHaveLength(2) // the MCQ section split when one question became True/False
    expect(prefill.questions.map((q) => q.question_type)).toEqual(['MCQ', 'TRUE_FALSE'])
    expect(prefill.questions.every((q) => !('needs_review' in q))).toBe(true)
    expect(prefill.uploadIds).toEqual([1])
  })
})
