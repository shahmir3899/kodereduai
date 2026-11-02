import { screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders } from '../../../test/utils'
import AssignmentsPage from '../AssignmentsPage'

// ── Context & hook mocks ─────────────────────────────────────────────────────

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'manager', role: 'MANAGER' },
    activeSchool: { id: 1, name: 'Test School', role: 'MANAGER', is_default: true },
    loading: false,
    isModuleEnabled: () => true,
    isSchoolAdmin: false,
    isTeacher: false,
    isManager: true,
  }),
}))

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}))

vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({
    activeAcademicYear: { id: 1, name: '2025-2026' },
    academicYears: [{ id: 1, name: '2025-2026' }],
  }),
}))

vi.mock('../../../hooks/useSessionClasses', () => ({
  useSessionClasses: () => ({ sessionClasses: [] }),
}))

vi.mock('../../../utils/classScope', () => ({
  getClassSelectorScope: () => 'master',
  getResolvedMasterClassId: (val) => val,
}))

vi.mock('../../../components/ClassSelector', () => ({
  default: ({ value, onChange }) => (
    <select data-testid="class-selector" value={value || ''} onChange={onChange}>
      <option value="">All Classes</option>
      <option value="1">Class 1A</option>
    </select>
  ),
}))

vi.mock('../../../components/SubjectSelector', () => ({
  default: ({ value, onChange }) => (
    <select data-testid="subject-selector" value={value || ''} onChange={onChange}>
      <option value="">All Subjects</option>
      <option value="1">Mathematics</option>
    </select>
  ),
}))

vi.mock('../../../components/teacher/TeacherScopeSummary', () => ({
  default: () => null,
}))

vi.mock('../../../components/teacher/TeacherScopeBadge', () => ({
  default: () => null,
  TeacherScopeHint: () => null,
  useTeacherScopeLookup: () => ({ classifyScope: () => null }),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => vi.fn() }
})

// A manager prepares drafts only; the server picks the teacher and a teacher publishes.
describe('AssignmentsPage as a manager', () => {
  it('offers no teacher picker and explains where the teacher comes from', () => {
    renderWithProviders(<AssignmentsPage />)
    fireEvent.click(screen.getByText('Create Assignment'))

    expect(screen.queryByText('Teacher *')).not.toBeInTheDocument()
    expect(screen.getByText(/Set automatically from the subject/)).toBeInTheDocument()
  })

  it('locks the status to DRAFT', () => {
    renderWithProviders(<AssignmentsPage />)
    fireEvent.click(screen.getByText('Create Assignment'))

    const status = screen.getAllByRole('combobox').find((el) => el.value === 'DRAFT')
    expect(status).toBeDefined()
    expect(status).toBeDisabled()
  })
})
