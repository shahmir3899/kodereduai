import { screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders } from '../../../test/utils'
import LessonPlansPage from '../LessonPlansPage'

// Mock hooks/contexts
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

vi.mock('../../../hooks/useClasses', () => ({
  useClasses: () => ({
    classes: [
      { id: 1, name: 'Class 1A', section: 'A', grade_level: 1 },
      { id: 2, name: 'Class 2B', section: 'B', grade_level: 2 },
    ],
    isLoading: false,
  }),
}))

vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({
    activeAcademicYear: { id: 1, name: '2025-2026' },
    academicYears: [{ id: 1, name: '2025-2026' }],
  }),
}))

// Mock ClassSelector to avoid its internal complexity
vi.mock('../../../components/ClassSelector', () => ({
  default: ({ value, onChange }) => (
    <select data-testid="class-selector" value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">All Classes</option>
      <option value="1">Class 1A</option>
      <option value="2">Class 2B</option>
    </select>
  ),
}))

const WAIT_OPTS = { timeout: 3000 }

describe('LessonPlansPage', () => {
  describe('Rendering', () => {
    it('renders header with Add button', async () => {
      renderWithProviders(<LessonPlansPage />)
      expect(screen.getByText('Lesson Plans')).toBeInTheDocument()
      expect(screen.getByText('Add Lesson Plan')).toBeInTheDocument()
    })

    it('renders filters', async () => {
      renderWithProviders(<LessonPlansPage />)
      // Class selector
      expect(screen.getByTestId('class-selector')).toBeInTheDocument()
      // Search input
      expect(screen.getByPlaceholderText('Search by title...')).toBeInTheDocument()
    })
  })

  describe('Table', () => {
    it('displays plan titles and metadata', async () => {
      renderWithProviders(<LessonPlansPage />)
      await waitFor(() => {
        // Titles appear in both mobile cards and desktop table
        expect(screen.getAllByText('Introduction to Algebra').length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText('Geometry Basics').length).toBeGreaterThanOrEqual(1)
      }, WAIT_OPTS)
    })

    it('shows status badges', async () => {
      renderWithProviders(<LessonPlansPage />)
      await waitFor(() => {
        // Component renders plan.status directly (uppercase)
        expect(screen.getAllByText('DRAFT').length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText('PUBLISHED').length).toBeGreaterThanOrEqual(1)
      }, WAIT_OPTS)
    })

    it('shows AI badge for AI-generated plans', async () => {
      renderWithProviders(<LessonPlansPage />)
      await waitFor(() => {
        // Desktop table shows "AI", mobile cards show "AI Generated"
        const aiBadges = screen.getAllByText(/^AI/)
        expect(aiBadges.length).toBeGreaterThanOrEqual(1)
      }, WAIT_OPTS)
    })

    it('shows class and subject names', async () => {
      renderWithProviders(<LessonPlansPage />)
      await waitFor(() => {
        // Both plans are for Class 1A / Mathematics
        const classNames = screen.getAllByText('Class 1A')
        expect(classNames.length).toBeGreaterThanOrEqual(1)
        const subjectNames = screen.getAllByText('Mathematics')
        expect(subjectNames.length).toBeGreaterThanOrEqual(1)
      }, WAIT_OPTS)
    })
  })

  describe('Actions', () => {
    it('Add button shows wizard', async () => {
      renderWithProviders(<LessonPlansPage />)
      fireEvent.click(screen.getByText('Add Lesson Plan'))
      await waitFor(() => {
        // Wizard should appear with step content
        expect(screen.getByText('Class & Date')).toBeInTheDocument()
      })
    })
  })

  describe('Filters', () => {
    it('search filters plans client-side', async () => {
      renderWithProviders(<LessonPlansPage />)
      await waitFor(() => {
        expect(screen.getAllByText('Introduction to Algebra').length).toBeGreaterThanOrEqual(1)
      }, WAIT_OPTS)
      const searchInput = screen.getByPlaceholderText('Search by title...')
      fireEvent.change(searchInput, { target: { value: 'Geometry' } })
      await waitFor(() => {
        expect(screen.queryByText('Introduction to Algebra')).not.toBeInTheDocument()
        expect(screen.getAllByText('Geometry Basics').length).toBeGreaterThanOrEqual(1)
      })
    })
  })

  describe('Empty state', () => {
    it('shows empty message when no plans exist', async () => {
      // Override with empty data — use server.use to override the handler
      const { server } = await import('../../../test/mocks/server')
      const { http, HttpResponse } = await import('msw')
      server.use(
        http.get('/api/lms/lesson-plans/', () =>
          HttpResponse.json({ count: 0, results: [] })
        )
      )
      renderWithProviders(<LessonPlansPage />)
      await waitFor(() => {
        expect(screen.getByText(/No lesson plans found/)).toBeInTheDocument()
      }, WAIT_OPTS)
    })
  })
})
