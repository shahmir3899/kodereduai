import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/utils'
import ExamWizard from '../ExamWizard'

const mockGetAcademicYears = vi.fn()
const mockGetTerms = vi.fn()
const mockGetExamTypes = vi.fn()
const mockGetAllClassSubjects = vi.fn()
const mockWizardCreateExamGroup = vi.fn()

vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({
    activeAcademicYear: { id: 1, name: 'Academic Year 2026-27' },
    currentTerm: { id: 11, name: '1st Term' },
  }),
}))

vi.mock('../../../hooks/useClasses', () => ({
  useClasses: () => ({
    classes: [
      { id: 1, name: 'Class 1', section: 'A' },
      { id: 2, name: 'Class 2', section: 'B' },
    ],
  }),
}))

vi.mock('../../../services/api', () => ({
  sessionsApi: {
    getAcademicYears: (...args) => mockGetAcademicYears(...args),
    getTerms: (...args) => mockGetTerms(...args),
  },
  examinationsApi: {
    getExamTypes: (...args) => mockGetExamTypes(...args),
    wizardCreateExamGroup: (...args) => mockWizardCreateExamGroup(...args),
  },
  academicsApi: {
    getClassSubjects: (...args) => mockGetAllClassSubjects(...args),
  },
}))

// Class 1 has 3 subjects, Class 2 has 1 — the max (3) drives the required
// date-range length once both classes are selected.
const ALL_CLASS_SUBJECTS = [
  { id: 1, class_obj: 1, subject: 201, subject_name: 'Mathematics', subject_code: 'MATH' },
  { id: 2, class_obj: 1, subject: 202, subject_name: 'English', subject_code: 'ENG' },
  { id: 3, class_obj: 1, subject: 203, subject_name: 'Science', subject_code: 'SCI' },
  { id: 4, class_obj: 2, subject: 201, subject_name: 'Mathematics', subject_code: 'MATH' },
]

async function advanceToStep3(user, { startDate } = {}) {
  renderWithProviders(<ExamWizard onClose={vi.fn()} onSuccess={vi.fn()} />)

  await waitFor(() => {
    expect(screen.getByText('Create Exam Group')).toBeInTheDocument()
  })

  const examTypeOption = await screen.findByRole('option', { name: 'Mid-Term (50%)' })
  await user.selectOptions(examTypeOption.closest('select'), '5')

  if (startDate) {
    const [startInput] = document.querySelectorAll('input[type="date"]')
    fireEvent.change(startInput, { target: { value: startDate } })
  }

  await user.click(screen.getByRole('button', { name: 'Next' }))

  await waitFor(() => {
    expect(screen.getByText('Select classes for this exam')).toBeInTheDocument()
  })
  const class1Checkbox = screen.getByText('Class 1 - A').closest('label').querySelector('input[type="checkbox"]')
  const class2Checkbox = screen.getByText('Class 2 - B').closest('label').querySelector('input[type="checkbox"]')
  await user.click(class1Checkbox)
  await user.click(class2Checkbox)

  await user.click(screen.getByRole('button', { name: 'Next' }))

  await waitFor(() => {
    expect(screen.getByText('Assign Exam Dates & Times')).toBeInTheDocument()
  })
}

describe('ExamWizard — Step 3 date-range auto-extension', () => {
  beforeEach(() => {
    mockGetAcademicYears.mockResolvedValue({ data: [{ id: 1, name: 'Academic Year 2026-27' }] })
    mockGetTerms.mockResolvedValue({ data: [{ id: 11, name: '1st Term' }] })
    mockGetExamTypes.mockResolvedValue({ data: [{ id: 5, name: 'Mid-Term', weight: 50 }] })
    mockGetAllClassSubjects.mockResolvedValue({ data: ALL_CLASS_SUBJECTS })
    mockWizardCreateExamGroup.mockResolvedValue({
      data: { group_id: 99, group_name: 'Mid-Term', exams_created: 2, subjects_created: 4 },
    })
  })

  it('auto-extends a blank end_date to fit the class with the most subjects, and shows the inline note', async () => {
    const user = userEvent.setup()
    await advanceToStep3(user, { startDate: '2026-05-01' })

    // 3 subjects needed (Class 1's count) => end_date = start_date + 2 days = 2026-05-03
    await waitFor(() => {
      expect(screen.getByText(/End date adjusted to 2026-05-03/)).toBeInTheDocument()
    })
    expect(screen.getByText(/to fit 3 subjects/)).toBeInTheDocument()
  })

  it('does not show the adjustment note when the existing range already fits', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ExamWizard onClose={vi.fn()} onSuccess={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('Create Exam Group')).toBeInTheDocument()
    })
    const examTypeOption = await screen.findByRole('option', { name: 'Mid-Term (50%)' })
    await user.selectOptions(examTypeOption.closest('select'), '5')

    const [startInput, endInput] = document.querySelectorAll('input[type="date"]')
    fireEvent.change(startInput, { target: { value: '2026-05-01' } })
    fireEvent.change(endInput, { target: { value: '2026-05-10' } }) // 10-day window, comfortably fits 3 subjects

    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => screen.getByText('Select classes for this exam'))
    const class1Checkbox = screen.getByText('Class 1 - A').closest('label').querySelector('input[type="checkbox"]')
    const class2Checkbox = screen.getByText('Class 2 - B').closest('label').querySelector('input[type="checkbox"]')
    await user.click(class1Checkbox)
    await user.click(class2Checkbox)
    await user.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => {
      expect(screen.getByText('Assign Exam Dates & Times')).toBeInTheDocument()
    })
    expect(screen.queryByText(/End date adjusted/)).not.toBeInTheDocument()
  })

  it('does not hard-cap per-row date inputs to the start/end range', async () => {
    const user = userEvent.setup()
    await advanceToStep3(user, { startDate: '2026-05-01' })

    await waitFor(() => {
      expect(document.querySelectorAll('table input[type="date"]').length).toBeGreaterThan(0)
    })
    const rowDateInputs = [...document.querySelectorAll('table input[type="date"]')]
    rowDateInputs.forEach((input) => {
      expect(input).not.toHaveAttribute('min')
      expect(input).not.toHaveAttribute('max')
    })
  })

  it('persists the auto-adjusted end_date into the wizard-create payload on submit', async () => {
    const user = userEvent.setup()
    await advanceToStep3(user, { startDate: '2026-05-01' })

    await waitFor(() => {
      expect(screen.getByText(/End date adjusted to 2026-05-03/)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Next' })) // -> Step 4 Preview
    await waitFor(() => {
      expect(screen.getByText('2026-05-01 to 2026-05-03')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /Create \d+ Exam\(s\)/ }))

    await waitFor(() => {
      expect(mockWizardCreateExamGroup).toHaveBeenCalledTimes(1)
      const payload = mockWizardCreateExamGroup.mock.calls[0][0]
      expect(payload.start_date).toBe('2026-05-01')
      expect(payload.end_date).toBe('2026-05-03')
    })
  })
})
