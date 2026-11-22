import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WorksheetBuilderPage from '../WorksheetBuilderPage'
import { renderWithProviders } from '../../../test/utils'

const editorProps = vi.fn()
const mockGetWorksheet = vi.fn()
const mockAutosave = vi.fn()
const mockConfirm = vi.fn()
let params = { worksheetId: '7' }

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => params }
})
vi.mock('../../../components/Toast', () => ({ useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }) }))
vi.mock('../../../contexts/AcademicYearContext', () => ({ useAcademicYear: () => ({ activeAcademicYear: { id: 1 } }) }))
vi.mock('../../../hooks/useSessionClasses', () => ({ useSessionClasses: () => ({ sessionClasses: [] }) }))
vi.mock('../../../hooks/useClassSubjects', () => ({
  useClassSubjects: () => ({ subjects: [{ id: 3, name: 'Maths' }], isLoading: false }),
}))
vi.mock('../../../components/ClassSelector', () => ({ default: () => <select aria-label="Class" /> }))
vi.mock('../blocks/BlockPaperEditor', () => ({
  default: (props) => { editorProps(props); return <div data-testid="block-editor" /> },
}))
vi.mock('../../../services/api', () => ({
  worksheetApi: {
    getWorksheet: (...a) => mockGetWorksheet(...a),
    autosaveDraft: (...a) => mockAutosave(...a),
    ensureDraft: vi.fn(),
  },
  questionPaperApi: { confirmPaperUpload: (...a) => mockConfirm(...a) },
}))

const sheet = (extra = {}) => ({
  data: {
    id: 7, title: 'Counting', instructions: '', class_obj: 1, class_name: 'Class 1', subject: 3,
    subject_name: 'Maths', status: 'DRAFT', ...extra,
  },
})

describe('WorksheetBuilderPage (block editor)', () => {
  beforeEach(() => {
    params = { worksheetId: '7' }
    editorProps.mockClear()
    mockAutosave.mockReset().mockResolvedValue({ data: {} })
    mockConfirm.mockReset().mockResolvedValue({ data: {} })
  })

  it('opens the block editor as a worksheet', async () => {
    mockGetWorksheet.mockResolvedValue(sheet())
    renderWithProviders(<WorksheetBuilderPage />)
    await screen.findByTestId('block-editor')
    const props = editorProps.mock.calls.at(-1)[0]
    expect(props).toMatchObject({ kind: 'worksheet', paperId: 7, classId: 1, subjectId: 3, readOnly: false, paperTitle: 'Counting' })
    expect(screen.queryByText('Choose the subject')).toBeNull()
  })

  it('autosaves typed details without blocks', async () => {
    mockGetWorksheet.mockResolvedValue(sheet())
    renderWithProviders(<WorksheetBuilderPage />)
    const title = await screen.findByLabelText('Worksheet title')
    await userEvent.type(title, ' sheet')
    await waitFor(() => expect(mockAutosave).toHaveBeenCalled(), { timeout: 3000 })
    const [id, payload] = mockAutosave.mock.calls.at(-1)
    expect(id).toBe('7')
    expect(payload).toEqual({ title: 'Counting sheet', instructions: '', subject: 3 })
    expect(payload).not.toHaveProperty('document')
  })

  it('asks for a subject when an old worksheet has none, and is read only when not a draft', async () => {
    mockGetWorksheet.mockResolvedValue(sheet({ subject: null, subject_name: null, status: 'READY' }))
    renderWithProviders(<WorksheetBuilderPage />)
    await screen.findByTestId('block-editor')
    expect(screen.getByText('Choose the subject')).toBeTruthy()
    expect(editorProps.mock.calls.at(-1)[0].readOnly).toBe(true)
  })

  it('records the scan feedback against the worksheet', async () => {
    mockGetWorksheet.mockResolvedValue(sheet())
    renderWithProviders(<WorksheetBuilderPage />)
    await screen.findByTestId('block-editor')
    editorProps.mock.calls.at(-1)[0].onCapturedPaper({ uploadIds: [11, 12], blocks: [{ type: 'mcq' }] })
    expect(mockConfirm).toHaveBeenCalledWith(11, { worksheet_id: 7, confirmed_data: { blocks: [{ type: 'mcq' }] } })
    expect(mockConfirm).toHaveBeenCalledWith(12, expect.objectContaining({ worksheet_id: 7 }))
  })

  it('needs a subject to create a new worksheet', () => {
    params = { worksheetId: 'new' }
    renderWithProviders(<WorksheetBuilderPage />)
    expect(screen.getByRole('button', { name: 'Create Worksheet' }).disabled).toBe(true)
  })
})
