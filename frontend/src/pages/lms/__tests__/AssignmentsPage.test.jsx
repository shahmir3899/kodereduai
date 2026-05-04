import { screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders } from '../../../test/utils'
import AssignmentsPage from '../AssignmentsPage'

// ── Context & hook mocks ─────────────────────────────────────────────────────

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'admin', role: 'SCHOOL_ADMIN' },
    activeSchool: { id: 1, name: 'Test School', role: 'SCHOOL_ADMIN', is_default: true },
    loading: false,
    isModuleEnabled: () => true,
    isSchoolAdmin: true,
    isTeacher: false,
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

const WAIT = { timeout: 3000 }

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AssignmentsPage', () => {
  describe('Static content', () => {
    it('renders the page header', () => {
      renderWithProviders(<AssignmentsPage />)
      expect(screen.getByText('Assignments')).toBeInTheDocument()
      expect(screen.getByText('Create Assignment')).toBeInTheDocument()
    })

    it('shows the assignment-types explainer panel', () => {
      renderWithProviders(<AssignmentsPage />)
      expect(screen.getByText('Assignment Types')).toBeInTheDocument()
      // Check at least two type labels are present
      expect(screen.getAllByText('HOMEWORK').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('DIARY').length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Assignment table', () => {
    it('displays HOMEWORK assignment title', async () => {
      renderWithProviders(<AssignmentsPage />)
      await waitFor(() => {
        expect(screen.getAllByText('Chapter 5 Homework').length).toBeGreaterThanOrEqual(1)
      }, WAIT)
    })

    it('displays DIARY assignment title', async () => {
      renderWithProviders(<AssignmentsPage />)
      await waitFor(() => {
        expect(screen.getAllByText('Monday Class Diary').length).toBeGreaterThanOrEqual(1)
      }, WAIT)
    })
  })

  describe('Create / Edit modal — assignment type', () => {
    it('does not offer DIARY in assignment type when creating (diary uses Create Daily Diary)', async () => {
      renderWithProviders(<AssignmentsPage />)

      fireEvent.click(screen.getByText('Create Assignment'))
      expect(screen.getByText('Create Assignment', { selector: 'h2' })).toBeInTheDocument()

      const typeSelect = screen.getByDisplayValue('HOMEWORK')
      const values = Array.from(typeSelect.querySelectorAll('option')).map((o) => o.value)
      expect(values).not.toContain('DIARY')
    })

    it('shows requires_submission toggle for non-DIARY types', async () => {
      renderWithProviders(<AssignmentsPage />)
      fireEvent.click(screen.getByText('Create Assignment'))
      // Default is HOMEWORK — toggle should be visible
      expect(screen.getByText('Require student submission')).toBeInTheDocument()
    })
  })
})
