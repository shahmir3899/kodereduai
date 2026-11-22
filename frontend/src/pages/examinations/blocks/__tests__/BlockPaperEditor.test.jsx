import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const api = vi.hoisted(() => ({
  getBlockTypes: vi.fn(),
  getPaperDocument: vi.fn(),
  previewDocument: vi.fn(),
  getPrintHtml: vi.fn(),
}))

vi.mock('../../../../services/api', () => ({
  questionPaperApi: {
    getBlockTypes: api.getBlockTypes,
    getPaperDocument: api.getPaperDocument,
    saveDocument: vi.fn(),
    previewDocument: api.previewDocument,
    getPrintHtml: api.getPrintHtml,
    getAnswerKeyHtml: vi.fn(),
    generateDOCX: vi.fn(),
  },
  worksheetApi: {},
}))
vi.mock('../../../../components/Toast', () => ({
  useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn(), showWarning: vi.fn() }),
}))
// Heavy children the load-error path never reaches.
vi.mock('../../QuestionBankPicker', () => ({ default: () => null }))
vi.mock('../../ImageCapturePaperTab', () => ({ default: () => null }))

import BlockPaperEditor from '../BlockPaperEditor'

function renderEditor(props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <BlockPaperEditor paperId={7} paperTitle="Test paper" {...props} />
    </QueryClientProvider>,
  )
}

const registry = { blocks: [
  { type: 'count_write', kind: 'activity', label: 'Count and write', fields: [{ name: 'rows', label: 'Rows', kind: 'list', max: 12, fields: [
    { name: 'picture', label: 'Picture', kind: 'picture' }, { name: 'count', label: 'How many', kind: 'int', min: 1, max: 7, default: 3 }] }] },
], structure_templates: [] }
const halfWritten = { blocks: [
  { id: 'a', type: 'count_write', title: 'Count A', marks: 5, data: { rows: [{ picture: 'cat', count: 2 }] } },
  { id: 'b', type: 'count_write', title: 'Count B', marks: 5, data: { rows: [{ picture: '', count: 3 }] } },
] }

describe('BlockPaperEditor load failure (demo findings A6)', () => {
  beforeEach(() => { Object.values(api).forEach((fn) => fn.mockReset()) })

  it('shows Try again after a failed load and opens the paper when the next try works', async () => {
    api.getBlockTypes.mockResolvedValue({ data: { blocks: [] } })
    api.previewDocument.mockResolvedValue({ data: '<p>preview</p>' })
    api.getPaperDocument
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce({ data: { document: { blocks: [] }, converted: false } })

    renderEditor()
    expect(await screen.findByText(/could not be opened/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    expect(await screen.findByText(/Total marks/)).toBeTruthy()
    expect(screen.queryByText(/could not be opened/i)).toBeNull()
    expect(api.getPaperDocument).toHaveBeenCalledTimes(2)
  })

  it('retries the block list too when the server was away for both (it waited on "Opening" for ever)', async () => {
    api.getBlockTypes
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce({ data: { blocks: [] } })
    api.previewDocument.mockResolvedValue({ data: '<p>preview</p>' })
    api.getPaperDocument
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce({ data: { document: { blocks: [] }, converted: false } })

    renderEditor()
    fireEvent.click(await screen.findByRole('button', { name: /try again/i }))

    expect(await screen.findByText(/Total marks/)).toBeTruthy()
    expect(api.getBlockTypes).toHaveBeenCalledTimes(2)
  })

  it('Structure makes the questions and hands over to Fill questions', async () => {
    api.getBlockTypes.mockResolvedValue({ data: registry })
    api.previewDocument.mockResolvedValue({ data: '<p>preview</p>' })
    api.getPaperDocument.mockResolvedValue({ data: { document: { blocks: [] } } })
    const onModeChange = vi.fn()
    renderEditor({ mode: 'structure', onModeChange })
    fireEvent.click(await screen.findByRole('button', { name: '+ Add questions' }))
    fireEvent.click(screen.getByRole('button', { name: /^Count and write/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 row' }))
    fireEvent.click(screen.getByRole('button', { name: 'Make the questions' }))
    expect(onModeChange).toHaveBeenCalledWith('fill')
  })

  it('shows what is still to fill, jumps to it, and says why a draft did not print', async () => {
    api.getBlockTypes.mockResolvedValue({ data: registry })
    api.previewDocument.mockResolvedValue({ data: '<p>preview</p>' })
    api.getPaperDocument.mockResolvedValue({ data: { document: halfWritten } })
    api.getPrintHtml.mockRejectedValue({ response: { status: 400, data: JSON.stringify({
      detail: 'Some questions are still to fill.', document: ['Still to fill: Question 2: Rows 1, Picture'] }) } })
    renderEditor({ onModeChange: vi.fn() })
    expect(await screen.findByText('1 still to fill')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next to fill' }))
    expect(screen.getByLabelText('Question heading').value).toBe('Count B')

    fireEvent.click(screen.getByRole('button', { name: /Print/ }))
    expect(await screen.findByText('Not printed yet: fill these first.')).toBeTruthy()
    expect(screen.getByText('Question 2: Rows 1, Picture')).toBeTruthy()
  })
})
