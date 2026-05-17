import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/utils'
import BulkTestModal from '../BulkTestModal'

const mockGetAcademicYears = vi.fn()
const mockGetTerms = vi.fn()
const mockGetExamTypes = vi.fn()
const mockGetClassSubjects = vi.fn()
const mockBulkTestPreview = vi.fn()
const mockBulkTestApply = vi.fn()

vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({
    activeAcademicYear: { id: 1, name: 'Academic Year 2026-27' },
    currentTerm: { id: 11, name: '1st Term' },
  }),
}))

vi.mock('../../../hooks/useSessionClasses', () => ({
  useSessionClasses: () => ({
    sessionClasses: [
      { id: 101, class_obj: 1 },
    ],
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
        <option value="">Select...</option>
        <option value="1">Class 1-A</option>
      </select>
    )
  },
}))

vi.mock('../../../services/api', () => ({
  sessionsApi: {
    getAcademicYears: (...args) => mockGetAcademicYears(...args),
    getTerms: (...args) => mockGetTerms(...args),
  },
  examinationsApi: {
    getExamTypes: (...args) => mockGetExamTypes(...args),
    bulkTestPreview: (...args) => mockBulkTestPreview(...args),
    bulkTestApply: (...args) => mockBulkTestApply(...args),
  },
  academicsApi: {
    getClassSubjects: (...args) => mockGetClassSubjects(...args),
  },
}))

describe('BulkTestModal', () => {
  beforeEach(() => {
    mockGetAcademicYears.mockResolvedValue({ data: [{ id: 1, name: 'Academic Year 2026-27' }] })
    mockGetTerms.mockResolvedValue({ data: [{ id: 11, name: '1st Term' }] })
    mockGetExamTypes.mockResolvedValue({ data: [{ id: 5, name: 'Unit Test' }] })
    mockGetClassSubjects.mockResolvedValue({
      data: [
        { id: 1, subject: 201, subject_name: 'Mathematics', subject_code: 'MATH' },
        { id: 2, subject: 202, subject_name: 'English', subject_code: 'ENG' },
      ],
    })
    mockBulkTestPreview.mockResolvedValue({
      data: {
        counts: { requested: 2, create: 2, conflict: 0, forbidden: 0, invalid: 0 },
        can_apply: true,
        tests: [
          { subject_id: 201, subject_name: 'Mathematics', subject_code: 'MATH', name: 'Test - Mathematics - 1st Term 2026-27', exam_date: '2026-05-20', status: 'create', reason: '' },
          { subject_id: 202, subject_name: 'English', subject_code: 'ENG', name: 'Test - English - 1st Term 2026-27', exam_date: '2026-05-21', status: 'create', reason: '' },
        ],
      },
    })
    mockBulkTestApply.mockResolvedValue({ data: { created_count: 2 } })
  })

  it('prefills academic year and term from session context', async () => {
    renderWithProviders(<BulkTestModal onClose={vi.fn()} onSuccess={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Academic Year 2026-27')).toBeInTheDocument()
      expect(screen.getByDisplayValue('1st Term')).toBeInTheDocument()
    })
  })

  it('runs preview then apply with expected payload wiring', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    renderWithProviders(<BulkTestModal onClose={vi.fn()} onSuccess={onSuccess} />)

    await waitFor(() => {
      expect(screen.getByText('Create Tests')).toBeInTheDocument()
    })

    const examTypeOption = await screen.findByRole('option', { name: 'Unit Test' })
    const examTypeSelect = examTypeOption.closest('select')
    await user.selectOptions(examTypeSelect, '5')

    const classSelect = screen.getByLabelText('Class')
    await user.selectOptions(classSelect, '1')

    await waitFor(() => {
      expect(screen.getByText('Mathematics')).toBeInTheDocument()
      expect(screen.getByText('English')).toBeInTheDocument()
    })

    const mathCheckbox = screen.getByText('Mathematics').closest('label')?.querySelector('input[type="checkbox"]')
    const englishCheckbox = screen.getByText('English').closest('label')?.querySelector('input[type="checkbox"]')
    await user.click(mathCheckbox)
    await user.click(englishCheckbox)

    await user.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => {
      expect(document.querySelectorAll('input[type="date"]').length).toBe(2)
    })
    const dateInputs = [...document.querySelectorAll('input[type="date"]')]
    fireEvent.change(dateInputs[0], { target: { value: '2026-05-20' } })
    fireEvent.change(dateInputs[1], { target: { value: '2026-05-21' } })

    await user.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => {
      expect(mockBulkTestPreview).toHaveBeenCalledTimes(1)
      const payload = mockBulkTestPreview.mock.calls[0][0]
      expect(payload.academic_year).toBe(1)
      expect(payload.term).toBe(11)
      expect(payload.exam_type).toBe(5)
      expect(payload.class_obj).toBe(1)
      expect(payload.tests).toHaveLength(2)
    })

    await user.click(screen.getByRole('button', { name: 'Create Tests' }))

    await waitFor(() => {
      expect(mockBulkTestApply).toHaveBeenCalledTimes(1)
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
  })
})
