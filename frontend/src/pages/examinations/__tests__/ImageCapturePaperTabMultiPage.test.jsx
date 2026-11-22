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

const mockUploadPaperImage = vi.fn()
const mockGetPaperGroupStatus = vi.fn()

vi.mock('../../../services/api', () => ({
  questionPaperApi: {
    uploadPaperImage: (...args) => mockUploadPaperImage(...args),
    getPaperGroupStatus: (...args) => mockGetPaperGroupStatus(...args),
  },
}))

const status = (pages, result = null) => ({
  data: {
    group_id: 'g', total_pages: pages.length, pages, missing_pages: [], failed_pages: [], extra_pages: [],
    complete: pages.every((p) => p.status === 'EXTRACTED'), result,
  },
})
const pageRow = (n, s = 'EXTRACTED') => ({ page_number: n, upload_id: n, status: s, error_message: '' })

// A merged block scan, as group-status returns it once every page is read.
const result = {
  scan_mode: 'blocks', direction: 'ltr', header: { subject: 'SS' }, notes: [],
  pictures: { library: 0, cropped: 0, missing: 0 },
  blocks: [
    { id: 'a', type: 'short_answer', title: 'Answer these.', marks: 4, page_number: 1, data: { items: [{ text: 'Why is the sky blue?' }] } },
    { id: 'b', type: 'true_false', title: 'True or false.', marks: 2, page_number: 2, data: { items: [{ text: 'The sun is a star.' }] } },
  ],
}

async function chooseCount(user, n) {
  const input = screen.getByLabelText('Total pages')
  await user.clear(input)
  await user.type(input, String(n))
  await user.click(screen.getByRole('button', { name: 'Continue' }))
}

describe('ImageCapturePaperTab: declared page count, parallel upload, block review', () => {
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

  it('opens the block review only after every declared page is read', async () => {
    mockGetPaperGroupStatus
      .mockResolvedValueOnce(status([pageRow(1), pageRow(2, 'PROCESSING')]))
      .mockResolvedValue(status([pageRow(1), pageRow(2)], result))
    localStorage.setItem('paper_builder_image_capture_1_1_blocks', JSON.stringify({ groupId: 'g', totalPages: 2 }))
    renderWithProviders(<ImageCapturePaperTab classId={1} subjectId={1} onApplyPrefill={vi.fn()} />)
    expect(await screen.findByText((_, el) => el?.tagName === 'P' && /^1 of 2 pages read/.test(el.textContent))).toBeInTheDocument()
    expect(screen.queryByText(/Answer these\./)).toBeNull()
    expect(await screen.findByText(/Answer these\./, {}, { timeout: 6000 })).toBeInTheDocument()
    expect(screen.getByText(/True or false\./)).toBeInTheDocument()
  }, 15000)

  it('hands the kept blocks, the direction and every page upload to the editor', async () => {
    mockGetPaperGroupStatus.mockResolvedValue(status([pageRow(1), pageRow(2)], result))
    localStorage.setItem('paper_builder_image_capture_1_1_blocks', JSON.stringify({ groupId: 'g', totalPages: 2 }))
    const onApplyPrefill = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<ImageCapturePaperTab classId={1} subjectId={1} onApplyPrefill={onApplyPrefill} />)
    await screen.findByText(/Answer these\./)
    await user.click(screen.getByRole('button', { name: 'Add 2 to the paper' }))
    const prefill = onApplyPrefill.mock.calls[0][0]
    expect(prefill.blocks.map((b) => b.type)).toEqual(['short_answer', 'true_false'])
    expect(prefill.direction).toBe('ltr')
    expect(prefill.uploadIds).toEqual([1, 2])
    expect(localStorage.getItem('paper_builder_image_capture_1_1_blocks')).toBeNull()
  })

  it('asks to scan again when the pages were read by the old scanner (no result)', async () => {
    mockGetPaperGroupStatus.mockResolvedValue(status([pageRow(1)], null))
    localStorage.setItem('paper_builder_image_capture_1_1_blocks', JSON.stringify({ groupId: 'g', totalPages: 1 }))
    renderWithProviders(<ImageCapturePaperTab classId={1} subjectId={1} onApplyPrefill={vi.fn()} />)
    expect(await screen.findByText(/read by the old scanner/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start over' })).toBeInTheDocument()
  })
})
