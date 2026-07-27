import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
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

async function fillStep1(user, { startDate = '2026-05-01', endDate = '2026-05-01' } = {}) {
  renderWithProviders(<ExamWizard onClose={vi.fn()} onSuccess={vi.fn()} />)

  await waitFor(() => {
    expect(screen.getByText('Create Exam Group')).toBeInTheDocument()
  })

  const examTypeOption = await screen.findByRole('option', { name: 'Mid-Term (50%)' })
  await user.selectOptions(examTypeOption.closest('select'), '5')

  const [startInput, endInput] = document.querySelectorAll('input[type="date"]')
  fireEvent.change(startInput, { target: { value: startDate } })
  fireEvent.change(endInput, { target: { value: endDate } })
}

async function advanceToStep2(user, dateOpts) {
  await fillStep1(user, dateOpts)
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await waitFor(() => {
    expect(screen.getByText('Select classes for this exam')).toBeInTheDocument()
  })
}

async function selectClasses(user, { class1 = true, class2 = true } = {}) {
  if (class1) {
    const class1Checkbox = screen.getByText('Class 1 - A').closest('label').querySelector('input[type="checkbox"]')
    await user.click(class1Checkbox)
  }
  if (class2) {
    const class2Checkbox = screen.getByText('Class 2 - B').closest('label').querySelector('input[type="checkbox"]')
    await user.click(class2Checkbox)
  }
}

async function advanceToStep3(user, dateOpts) {
  await advanceToStep2(user, dateOpts)
  await selectClasses(user)
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await waitFor(() => {
    expect(screen.getByText('Assign Exam Dates')).toBeInTheDocument()
  })
}

// Step 3 cells are buttons that open a checkbox popover, not <select>s —
// these helpers drive that interaction the way a user would.
async function openCellPicker(user, cellLabel) {
  await user.click(screen.getByLabelText(cellLabel))
  return screen.getByLabelText(cellLabel).closest('td')
}

async function toggleCellSubject(user, cellLabel, subjectName) {
  const td = await openCellPicker(user, cellLabel)
  // Scoped by accessible (implicit <label>) name, not text: once a subject is
  // already checked here its name appears twice in `td` — once as the
  // closed-state chip, once as the checkbox's label. `exact: false` because a
  // subject scheduled elsewhere shows its date appended inside the label too.
  await user.click(within(td).getByLabelText(subjectName, { exact: false }))
  await user.click(within(td).getByRole('button', { name: 'Done' }))
}

function cellChipNames(cellLabel) {
  const button = screen.getByLabelText(cellLabel)
  if (button.textContent.trim() === '+ Add subjects') return []
  return [...button.querySelectorAll('span')].map(s => s.textContent.trim())
}

describe('ExamWizard', () => {
  beforeEach(() => {
    mockGetAcademicYears.mockResolvedValue({ data: [{ id: 1, name: 'Academic Year 2026-27' }] })
    mockGetTerms.mockResolvedValue({ data: [{ id: 11, name: '1st Term' }] })
    mockGetExamTypes.mockResolvedValue({ data: [{ id: 5, name: 'Mid-Term', weight: 50 }] })
    mockGetAllClassSubjects.mockResolvedValue({ data: ALL_CLASS_SUBJECTS })
    mockWizardCreateExamGroup.mockResolvedValue({
      data: { group_id: 99, group_name: 'Mid-Term', exams_created: 2, subjects_created: 4 },
    })
  })

  describe('Step 1 — dates are now required', () => {
    it('blocks advancing past Step 1 without a start or end date', async () => {
      const user = userEvent.setup()
      renderWithProviders(<ExamWizard onClose={vi.fn()} onSuccess={vi.fn()} />)

      await waitFor(() => expect(screen.getByText('Create Exam Group')).toBeInTheDocument())
      const examTypeOption = await screen.findByRole('option', { name: 'Mid-Term (50%)' })
      await user.selectOptions(examTypeOption.closest('select'), '5')

      await user.click(screen.getByRole('button', { name: 'Next' }))

      // Still on Step 1 — required-field errors shown, class-selection UI never appears.
      expect(screen.getAllByText(/Required — Step 3 builds a calendar/).length).toBe(2)
      expect(screen.queryByText('Select classes for this exam')).not.toBeInTheDocument()
    })
  })

  describe('Step 2 — subject picker', () => {
    it('defaults to every available subject selected, nested under its own class', async () => {
      const user = userEvent.setup()
      await advanceToStep2(user)
      await selectClasses(user)

      const class1Row = screen.getByText('Class 1 - A').closest('div')
      await waitFor(() => {
        expect(within(class1Row).getByText('3 of 3 selected')).toBeInTheDocument()
      })
      const mathCheckbox = within(class1Row).getByText('Mathematics').closest('label').querySelector('input[type="checkbox"]')
      const englishCheckbox = within(class1Row).getByText('English').closest('label').querySelector('input[type="checkbox"]')
      expect(mathCheckbox).toBeChecked()
      expect(englishCheckbox).toBeChecked()

      const class2Row = screen.getByText('Class 2 - B').closest('div')
      expect(within(class2Row).getByText('1 of 1 selected')).toBeInTheDocument()
    })

    it('keeps each class\'s subject selection independent, even for a shared subject', async () => {
      const user = userEvent.setup()
      await advanceToStep2(user)
      await selectClasses(user)
      await waitFor(() => screen.getByText('3 of 3 selected'))

      const class1Row = screen.getByText('Class 1 - A').closest('div')
      const class2Row = screen.getByText('Class 2 - B').closest('div')

      const class2MathCheckbox = within(class2Row).getByText('Mathematics').closest('label').querySelector('input[type="checkbox"]')
      await user.click(class2MathCheckbox) // deselect Math for Class 2 only

      const class1MathCheckbox = within(class1Row).getByText('Mathematics').closest('label').querySelector('input[type="checkbox"]')
      expect(class1MathCheckbox).toBeChecked() // Class 1's Math is untouched
      expect(within(class2Row).getByText('0 of 1 selected')).toBeInTheDocument()
    })

    it('blocks advancing to Step 3 if every class ends up with zero subjects', async () => {
      const user = userEvent.setup()
      await advanceToStep2(user)
      await selectClasses(user)
      await waitFor(() => screen.getByText('3 of 3 selected'))

      const class1Row = screen.getByText('Class 1 - A').closest('div')
      const class2Row = screen.getByText('Class 2 - B').closest('div')
      await user.click(within(class1Row).getByRole('button', { name: 'None' }))
      await user.click(within(class2Row).getByRole('button', { name: 'None' }))

      await user.click(screen.getByRole('button', { name: 'Next' }))

      expect(screen.getByText('Select at least one subject for at least one class.')).toBeInTheDocument()
      expect(screen.queryByText('Assign Exam Dates')).not.toBeInTheDocument()
    })

    it('excludes a deselected subject from the Step 3 grid options for that class only', async () => {
      const user = userEvent.setup()
      await advanceToStep2(user)
      await selectClasses(user)
      await waitFor(() => screen.getByText('3 of 3 selected'))

      const class1Row = screen.getByText('Class 1 - A').closest('div')
      const scienceCheckbox = within(class1Row).getByText('Science').closest('label').querySelector('input[type="checkbox"]')
      await user.click(scienceCheckbox) // deselect Science for Class 1 only

      await user.click(screen.getByRole('button', { name: 'Next' }))
      await waitFor(() => expect(screen.getByText('Assign Exam Dates')).toBeInTheDocument())

      const td = await openCellPicker(user, '2026-05-01 - Class 1 - A')
      expect(within(td).getByText('English')).toBeInTheDocument()
      expect(within(td).getByText('Mathematics')).toBeInTheDocument()
      expect(within(td).queryByText('Science')).not.toBeInTheDocument()
    })
  })

  describe('Step 3 — Date x Class grid', () => {
    it('auto-extends an insufficient end_date to fit the class with the most subjects', async () => {
      const user = userEvent.setup()
      // start == end (1 day) is too short for Class 1's 3 subjects.
      await advanceToStep3(user, { startDate: '2026-05-01', endDate: '2026-05-01' })

      await waitFor(() => {
        expect(screen.getByText(/End date adjusted to 2026-05-03/)).toBeInTheDocument()
      })
      expect(screen.getByText(/to fit 3 subjects/)).toBeInTheDocument()
    })

    it('does not show the adjustment note when the existing range already fits', async () => {
      const user = userEvent.setup()
      await advanceToStep3(user, { startDate: '2026-05-01', endDate: '2026-05-10' })
      expect(screen.queryByText(/End date adjusted/)).not.toBeInTheDocument()
    })

    it('renders one row per calendar day and one column per selected class', async () => {
      const user = userEvent.setup()
      await advanceToStep3(user, { startDate: '2026-05-01', endDate: '2026-05-03' })

      expect(screen.getByLabelText('2026-05-01 - Class 1 - A')).toBeInTheDocument()
      expect(screen.getByLabelText('2026-05-02 - Class 1 - A')).toBeInTheDocument()
      expect(screen.getByLabelText('2026-05-03 - Class 1 - A')).toBeInTheDocument()
      expect(screen.getByLabelText('2026-05-01 - Class 2 - B')).toBeInTheDocument()

      // Class 2 only has Math assigned -- its cell picker offers just that one subject.
      const td = await openCellPicker(user, '2026-05-01 - Class 2 - B')
      expect(within(td).getByText('Mathematics')).toBeInTheDocument()
      expect(within(td).queryByText('English')).not.toBeInTheDocument()
    })

    it('lists every not-yet-placed subject under "Not yet scheduled"', async () => {
      const user = userEvent.setup()
      await advanceToStep3(user, { startDate: '2026-05-01', endDate: '2026-05-03' })

      expect(screen.getByText('Not yet scheduled:')).toBeInTheDocument()
      expect(screen.getByText('Mathematics (Class 1 - A)')).toBeInTheDocument()
      expect(screen.getByText('English (Class 1 - A)')).toBeInTheDocument()
      expect(screen.getByText('Science (Class 1 - A)')).toBeInTheDocument()
      expect(screen.getByText('Mathematics (Class 2 - B)')).toBeInTheDocument()
    })

    it('assigning a subject to a cell removes it from "Not yet scheduled"', async () => {
      const user = userEvent.setup()
      await advanceToStep3(user, { startDate: '2026-05-01', endDate: '2026-05-03' })

      await toggleCellSubject(user, '2026-05-01 - Class 1 - A', 'Mathematics')

      expect(screen.queryByText('Mathematics (Class 1 - A)')).not.toBeInTheDocument()
      expect(screen.getByText('English (Class 1 - A)')).toBeInTheDocument() // still unscheduled
    })

    it('a cell can hold more than one subject at once', async () => {
      const user = userEvent.setup()
      await advanceToStep3(user, { startDate: '2026-05-01', endDate: '2026-05-03' })

      await toggleCellSubject(user, '2026-05-01 - Class 1 - A', 'Mathematics')
      await toggleCellSubject(user, '2026-05-01 - Class 1 - A', 'English')

      expect(cellChipNames('2026-05-01 - Class 1 - A').sort()).toEqual(['English', 'Mathematics'])
      expect(screen.queryByText('Mathematics (Class 1 - A)')).not.toBeInTheDocument()
      expect(screen.queryByText('English (Class 1 - A)')).not.toBeInTheDocument()
    })

    it('unchecking a subject in a cell frees it back to unscheduled', async () => {
      const user = userEvent.setup()
      await advanceToStep3(user, { startDate: '2026-05-01', endDate: '2026-05-03' })

      await toggleCellSubject(user, '2026-05-01 - Class 1 - A', 'Mathematics')
      expect(cellChipNames('2026-05-01 - Class 1 - A')).toEqual(['Mathematics'])

      await toggleCellSubject(user, '2026-05-01 - Class 1 - A', 'Mathematics') // uncheck
      expect(cellChipNames('2026-05-01 - Class 1 - A')).toEqual([])
      expect(screen.getByText('Mathematics (Class 1 - A)')).toBeInTheDocument()
    })

    it('moves a subject to a new cell rather than duplicating it when checked elsewhere', async () => {
      const user = userEvent.setup()
      await advanceToStep3(user, { startDate: '2026-05-01', endDate: '2026-05-03' })

      await toggleCellSubject(user, '2026-05-01 - Class 1 - A', 'Mathematics') // Math -> May 1
      expect(cellChipNames('2026-05-01 - Class 1 - A')).toEqual(['Mathematics'])

      await toggleCellSubject(user, '2026-05-02 - Class 1 - A', 'Mathematics') // move Math -> May 2
      expect(cellChipNames('2026-05-02 - Class 1 - A')).toEqual(['Mathematics'])
      expect(cellChipNames('2026-05-01 - Class 1 - A')).toEqual([]) // freed, not duplicated
    })
  })

  describe('Step 3 — Add/Remove Date rows', () => {
    it('extends the grid by one day when "+ Add Date" is clicked', async () => {
      const user = userEvent.setup()
      await advanceToStep3(user, { startDate: '2026-05-01', endDate: '2026-05-03' })

      expect(screen.queryByLabelText('2026-05-04 - Class 1 - A')).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: '+ Add Date' }))
      expect(screen.getByLabelText('2026-05-04 - Class 1 - A')).toBeInTheDocument()
    })

    it('removes the trailing empty row, leaving earlier rows untouched', async () => {
      const user = userEvent.setup()
      await advanceToStep3(user, { startDate: '2026-05-01', endDate: '2026-05-03' })

      await user.click(screen.getByRole('button', { name: '+ Add Date' }))
      expect(screen.getByLabelText('2026-05-04 - Class 1 - A')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Remove last' }))
      expect(screen.queryByLabelText('2026-05-04 - Class 1 - A')).not.toBeInTheDocument()
      expect(screen.getByLabelText('2026-05-01 - Class 1 - A')).toBeInTheDocument()
    })

    it('does not offer to remove the trailing row once it has an assignment', async () => {
      const user = userEvent.setup()
      await advanceToStep3(user, { startDate: '2026-05-01', endDate: '2026-05-03' })

      await toggleCellSubject(user, '2026-05-03 - Class 1 - A', 'Science')
      expect(screen.queryByRole('button', { name: 'Remove last' })).not.toBeInTheDocument()
    })
  })

  describe('Submit payload', () => {
    it('sends class_subjects and the grid assignments as date_sheet entries', async () => {
      const user = userEvent.setup()
      await advanceToStep3(user, { startDate: '2026-05-01', endDate: '2026-05-03' })

      await toggleCellSubject(user, '2026-05-01 - Class 1 - A', 'Mathematics')
      await toggleCellSubject(user, '2026-05-02 - Class 1 - A', 'English')
      await toggleCellSubject(user, '2026-05-01 - Class 2 - B', 'Mathematics')

      await user.click(screen.getByRole('button', { name: 'Next' })) // -> Step 4 Preview
      await waitFor(() => {
        expect(screen.getByText('Date Sheet (3 entries)')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /Create \d+ Exam\(s\)/ }))

      await waitFor(() => {
        expect(mockWizardCreateExamGroup).toHaveBeenCalledTimes(1)
      })
      const payload = mockWizardCreateExamGroup.mock.calls[0][0]
      const subjectIdsByClass = Object.fromEntries(
        payload.class_subjects.map(cs => [cs.class_id, [...cs.subject_ids].sort((a, b) => a - b)])
      )
      expect(subjectIdsByClass).toEqual({ 1: [201, 202, 203], 2: [201] })
      expect(payload.date_sheet).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ class_id: 1, subject_id: 201, exam_date: '2026-05-01' }),
          expect.objectContaining({ class_id: 1, subject_id: 202, exam_date: '2026-05-02' }),
          expect.objectContaining({ class_id: 2, subject_id: 201, exam_date: '2026-05-01' }),
        ]),
      )
      expect(payload.date_sheet).toHaveLength(3)
    })
  })
})
