import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, createTestQueryClient } from '../../../test/utils'
import { DateSheetModal } from '../ExamsPage'

const mockGetDateSheet = vi.fn()
const mockUpdateDateSheet = vi.fn()
const mockDownloadDateSheet = vi.fn()
const mockDownloadDateSheetPdf = vi.fn()

vi.mock('../../../services/api', () => ({
  examinationsApi: {
    getDateSheet: (...args) => mockGetDateSheet(...args),
    updateDateSheet: (...args) => mockUpdateDateSheet(...args),
    downloadDateSheet: (...args) => mockDownloadDateSheet(...args),
    downloadDateSheetPdf: (...args) => mockDownloadDateSheetPdf(...args),
  },
  sessionsApi: {},
  academicsApi: {},
  classesApi: {},
}))

// Mathematics (Class 1 - A) is already dated; English (Class 1 - A) is not yet scheduled.
const DATE_SHEET_RESPONSE = {
  group_id: 5,
  group_name: 'Mid-Term',
  start_date: '2026-04-01',
  end_date: '2026-04-02',
  subjects: [
    {
      subject_id: 1,
      subject_name: 'Mathematics',
      subject_code: 'MATH',
      classes: [
        { exam_subject_id: 10, exam_id: 100, class_name: 'Class 1 - A', exam_date: '2026-04-01', start_time: null, end_time: null },
      ],
    },
    {
      subject_id: 2,
      subject_name: 'English',
      subject_code: 'ENG',
      classes: [
        { exam_subject_id: 11, exam_id: 100, class_name: 'Class 1 - A', exam_date: null, start_time: null, end_time: null },
      ],
    },
  ],
}

// DateSheetModal invalidates through the `queryClient` prop rather than
// useQueryClient(), so the same client instance must back both the
// QueryClientProvider (via renderWithProviders) and the prop.
function renderModal(props = {}) {
  const queryClient = createTestQueryClient()
  return renderWithProviders(
    <DateSheetModal groupId={5} onClose={vi.fn()} queryClient={queryClient} setListError={vi.fn()} {...props} />,
    { queryClient },
  )
}

// The modal's title/tabs render immediately regardless of load state, so
// waiting on those isn't enough to know the dateSheet query has resolved.
// "Not yet scheduled:" only renders once real data replaces the spinner (in
// this fixture, English is always unscheduled) -- a reliable "loaded" signal
// for every test that starts on the default Calendar view.
async function waitForLoaded() {
  await waitFor(() => expect(screen.getByText('Not yet scheduled:')).toBeInTheDocument())
}

describe('DateSheetModal', () => {
  beforeEach(() => {
    mockGetDateSheet.mockResolvedValue({ data: DATE_SHEET_RESPONSE })
    mockUpdateDateSheet.mockResolvedValue({ data: { updated_count: 1 } })
  })

  it('opens on the Calendar view by default', async () => {
    renderModal()
    await waitForLoaded()

    const calendarTab = screen.getByRole('button', { name: 'Calendar' })
    const tableTab = screen.getByRole('button', { name: 'Table' })
    expect(calendarTab.className).toMatch(/border-primary-600/)
    expect(tableTab.className).not.toMatch(/border-primary-600/)

    // Calendar-only markers: Day column header and a per-cell subject picker button.
    expect(screen.getByText('Day')).toBeInTheDocument()
    expect(screen.getByLabelText('2026-04-01 - Class 1 - A')).toBeInTheDocument()
  })

  it('switching to Table still renders and saves an edited date', async () => {
    renderModal()
    await waitForLoaded()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Table' }))

    expect(screen.getByText('Mathematics')).toBeInTheDocument()
    expect(screen.getByText('English')).toBeInTheDocument()

    const dateInputs = document.querySelectorAll('input[type="date"]')
    expect(dateInputs).toHaveLength(2)

    fireEvent.change(dateInputs[1], { target: { value: '2026-04-02' } })
    fireEvent.blur(dateInputs[1])

    await waitFor(() => expect(mockUpdateDateSheet).toHaveBeenCalledWith(5, [
      { exam_subject_id: 11, exam_date: '2026-04-02', start_time: null, end_time: null },
    ]))
  })

  it('Calendar view: assigning a subject to an empty cell persists it', async () => {
    const user = userEvent.setup()
    renderModal()
    await waitForLoaded()

    await user.click(screen.getByLabelText('2026-04-02 - Class 1 - A'))
    const td = screen.getByLabelText('2026-04-02 - Class 1 - A').closest('td')
    await user.click(within(td).getByText('English'))

    await waitFor(() => expect(mockUpdateDateSheet).toHaveBeenCalledWith(5, [
      { exam_subject_id: 11, exam_date: '2026-04-02' },
    ]))
  })

  it('shows the empty state when the group has no subjects', async () => {
    mockGetDateSheet.mockResolvedValue({
      data: { group_id: 6, group_name: 'Empty Group', start_date: null, end_date: null, subjects: [] },
    })
    renderModal({ groupId: 6 })

    await waitFor(() => {
      expect(screen.getByText('No subjects found in this exam group.')).toBeInTheDocument()
    })
  })
})
