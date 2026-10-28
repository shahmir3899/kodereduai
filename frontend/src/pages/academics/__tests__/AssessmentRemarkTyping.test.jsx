import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/utils'
import AssessmentsPage from '../AssessmentsPage'

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'SCHOOL_ADMIN' },
    activeSchool: { id: 1, name: 'Test School' },
    isTeacher: false, isSchoolAdmin: true, isPrincipal: false,
  }),
}))
vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ activeAcademicYear: { id: 5 } }),
}))
vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}))
vi.mock('../../../hooks/useSessionClasses', () => ({
  useSessionClasses: () => ({ sessionClasses: [{ id: 9, class_obj: 3 }] }),
}))
vi.mock('../../../hooks/useTeacherScopedClasses', async () => {
  const { useEffect } = await vi.importActual('react')
  return {
    default: ({ setSelectedClass }) => {
      useEffect(() => { setSelectedClass('9') }, [setSelectedClass])
      return { classOptions: null }
    },
  }
})
vi.mock('../../../components/ClassSelector', () => ({ default: () => <select /> }))
vi.mock('../../../utils/classScope', () => ({
  getClassSelectorScope: () => 'session',
  getResolvedMasterClassId: () => '3',
}))
vi.mock('../../../services/api', () => ({
  examinationsApi: {
    getStudentTermAssessmentRoster: vi.fn(() => Promise.resolve({
      data: { results: [{ student: 1, student_name: 'Ali Hassan', roll_number: '1', exists: false }] },
    })),
  },
}))

// The remark box was a component declared inside the page, so React remounted it
// on every keystroke and focus was lost after the first character.
describe('Assessments teacher remark', () => {
  it('keeps what you type, one character after another', async () => {
    renderWithProviders(<AssessmentsPage />)
    const boxes = await screen.findAllByPlaceholderText('Teacher observation')
    await userEvent.click(boxes[0])
    await userEvent.keyboard('Works hard')
    const live = screen.getAllByPlaceholderText('Teacher observation')[0]
    expect(live.value).toBe('Works hard')
  })
})
