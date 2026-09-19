import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockGet = vi.fn()
const mockSave = vi.fn()
vi.mock('../../../services/api', () => ({
  examinationsApi: {
    getReportCardBulkMeta: (...a) => mockGet(...a),
    saveReportCardBulkMeta: (...a) => mockSave(...a),
  },
}))

import BulkReportCardModal from '../BulkReportCardModal'

const students = [
  { studentId: 1, name: 'Ayesha', roll: '1' },
  { studentId: 2, name: 'Bilal', roll: '2' },
]

function renderModal(props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <BulkReportCardModal students={students} yearId="5" examIds={["9"]} onClose={onClose} {...props} />
    </QueryClientProvider>,
  )
  return { onClose }
}

describe('BulkReportCardModal', () => {
  beforeEach(() => {
    mockGet.mockReset()
    mockSave.mockReset()
    mockSave.mockResolvedValue({ data: { saved: true } })
  })

  it('sends promotions, issue date and captions for the whole class', async () => {
    mockGet.mockResolvedValue({ data: { students: {
      1: { promotion_applicable: true, promotion_status: 'NOT_APPLICABLE', issue_date: null },
      2: { promotion_applicable: true, promotion_status: 'NOT_APPLICABLE', issue_date: null },
    } } })
    const user = userEvent.setup()
    const { onClose } = renderModal()

    await screen.findByText('Ayesha', { exact: false })
    await user.selectOptions(screen.getByDisplayValue('Set all to…'), 'PROMOTED')
    const principal = screen.getAllByPlaceholderText("Leave blank to keep as is")[1]
    await user.type(principal, 'Head Teacher')
    await user.click(screen.getByRole('button', { name: /Save for 2 students/ }))

    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1))
    const payload = mockSave.mock.calls[0][0]
    expect(payload.student_ids).toEqual([1, 2])
    expect(payload.promotions).toEqual({ 1: 'PROMOTED', 2: 'PROMOTED' })
    expect(payload.signature_labels).toEqual({ principal: 'Head Teacher' })
    expect(payload.overwrite).toBe(true)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('hides promotion and sends none when the class has no final exam', async () => {
    mockGet.mockResolvedValue({ data: { students: {
      1: { promotion_applicable: false, promotion_status: 'NOT_APPLICABLE', issue_date: null },
      2: { promotion_applicable: false, promotion_status: 'NOT_APPLICABLE', issue_date: null },
    } } })
    const user = userEvent.setup()
    renderModal()

    await screen.findByText(/Promotion only applies to a final exam/)
    await user.click(screen.getByRole('button', { name: /Save for 2 students/ }))
    await waitFor(() => expect(mockSave).toHaveBeenCalled())
    expect(mockSave.mock.calls[0][0].promotions).toBeUndefined()
  })
})
