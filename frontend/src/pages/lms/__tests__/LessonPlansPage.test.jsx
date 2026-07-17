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
    <select data-testid="class-selector" value={value || ''} onChange={onChange}>
      <option value="">All Classes</option>
      <option value="1">Class 1A</option>
      <option value="2">Class 2B</option>
    </select>
  ),
}))

const WAIT_OPTS = { timeout: 3000 }

function selectClass1() {
  fireEvent.change(screen.getByTestId('class-selector'), { target: { value: '1' } })
}

// Mock plans fall within 2026-03-15 .. 2026-03-20; both are covered by this range.
function applyDateRange(container) {
  const dateInputs = container.querySelectorAll('input[type="date"]')
  fireEvent.change(dateInputs[0], { target: { value: '2026-03-01' } })
  fireEvent.change(dateInputs[1], { target: { value: '2026-03-31' } })
}

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
      expect(screen.getByPlaceholderText('Search by title or description...')).toBeInTheDocument()
    })
  })

  describe('Table', () => {
    it('does not load any plans until a class filter is applied', async () => {
      renderWithProviders(<LessonPlansPage />)
      await waitFor(() => {
        expect(screen.getByText(/No lesson plans yet/)).toBeInTheDocument()
      }, WAIT_OPTS)
      expect(screen.queryByText('Introduction to Algebra')).not.toBeInTheDocument()
      expect(screen.queryByText('Geometry Basics')).not.toBeInTheDocument()
    })

    it('does not load any plans when a class is selected but no date range is applied', async () => {
      renderWithProviders(<LessonPlansPage />)
      selectClass1()
      await waitFor(() => {
        expect(screen.getByText(/Select a valid lesson-date range/)).toBeInTheDocument()
      }, WAIT_OPTS)
      expect(screen.queryByText('Introduction to Algebra')).not.toBeInTheDocument()
      expect(screen.queryByText('Geometry Basics')).not.toBeInTheDocument()
    })

    it('displays plan titles and metadata once a class and date range are applied', async () => {
      const { container } = renderWithProviders(<LessonPlansPage />)
      selectClass1()
      applyDateRange(container)
      await waitFor(() => {
        // Titles appear in both mobile cards and desktop table
        expect(screen.getAllByText('Introduction to Algebra').length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText('Geometry Basics').length).toBeGreaterThanOrEqual(1)
      }, WAIT_OPTS)
    })

    it('shows status badges', async () => {
      const { container } = renderWithProviders(<LessonPlansPage />)
      selectClass1()
      applyDateRange(container)
      await waitFor(() => {
        // Component renders plan.status directly (uppercase)
        expect(screen.getAllByText('DRAFT').length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText('PUBLISHED').length).toBeGreaterThanOrEqual(1)
      }, WAIT_OPTS)
    })

    it('shows AI badge for AI-generated plans', async () => {
      const { container } = renderWithProviders(<LessonPlansPage />)
      selectClass1()
      applyDateRange(container)
      await waitFor(() => {
        // Desktop table shows "AI", mobile cards show "AI Generated"
        const aiBadges = screen.getAllByText(/^AI/)
        expect(aiBadges.length).toBeGreaterThanOrEqual(1)
      }, WAIT_OPTS)
    })

    it('shows class and subject names', async () => {
      const { container } = renderWithProviders(<LessonPlansPage />)
      selectClass1()
      applyDateRange(container)
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
    it('Add Lesson Plan button opens bulk lesson plans modal', async () => {
      renderWithProviders(<LessonPlansPage />)
      fireEvent.click(screen.getByText('Add Lesson Plan'))
      await waitFor(() => {
        expect(screen.getByText('Bulk lesson plans')).toBeInTheDocument()
      })
    })

    it('"Create single lesson plan" inside the bulk modal opens the single-plan create modal', async () => {
      renderWithProviders(<LessonPlansPage />)
      fireEvent.click(screen.getByText('Add Lesson Plan'))
      await waitFor(() => {
        expect(screen.getByText('Bulk lesson plans')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('Create single lesson plan'))
      await waitFor(() => {
        expect(screen.getAllByText('Create Lesson Plan').length).toBeGreaterThanOrEqual(1)
      })
      expect(screen.queryByText('Bulk lesson plans')).not.toBeInTheDocument()
    })
  })

  describe('Filters', () => {
    it('search filters plans client-side', async () => {
      const { container } = renderWithProviders(<LessonPlansPage />)
      selectClass1()
      applyDateRange(container)
      await waitFor(() => {
        expect(screen.getAllByText('Introduction to Algebra').length).toBeGreaterThanOrEqual(1)
      }, WAIT_OPTS)
      const searchInput = screen.getByPlaceholderText('Search by title or description...')
      fireEvent.change(searchInput, { target: { value: 'Geometry' } })
      await waitFor(() => {
        expect(screen.queryByText('Introduction to Algebra')).not.toBeInTheDocument()
        expect(screen.getAllByText('Geometry Basics').length).toBeGreaterThanOrEqual(1)
      })
    })
  })

  describe('Bulk actions', () => {
    // mockLessonPlans: id 1 'Introduction to Algebra' is DRAFT, id 2 'Geometry Basics' is PUBLISHED.
    function selectBothRowsInDesktopTable(container) {
      const table = container.querySelector('table')
      const rowCheckboxes = table.querySelectorAll('tbody input[type="checkbox"]')
      fireEvent.click(rowCheckboxes[0])
      fireEvent.click(rowCheckboxes[1])
    }

    it('shows the bulk actions toolbar with correct counts once plans are selected', async () => {
      const { container } = renderWithProviders(<LessonPlansPage />)
      selectClass1()
      applyDateRange(container)
      await waitFor(() => {
        expect(screen.getAllByText('Introduction to Algebra').length).toBeGreaterThanOrEqual(1)
      }, WAIT_OPTS)

      selectBothRowsInDesktopTable(container)

      await waitFor(() => {
        expect(screen.getByText('2 selected')).toBeInTheDocument()
      })
      // Only the DRAFT plan is approvable.
      expect(screen.getByText('Approve Selected (1)')).toBeInTheDocument()
      expect(screen.getByText('Delete Selected (2)')).toBeInTheDocument()
    })

    it('bulk approve only publishes the selected draft plan(s), leaving other selections untouched', async () => {
      const { container } = renderWithProviders(<LessonPlansPage />)
      selectClass1()
      applyDateRange(container)
      await waitFor(() => {
        expect(screen.getAllByText('Introduction to Algebra').length).toBeGreaterThanOrEqual(1)
      }, WAIT_OPTS)

      // Row 0 (DRAFT) and row 1 (already PUBLISHED) are both selected.
      selectBothRowsInDesktopTable(container)
      fireEvent.click(screen.getByText('Approve Selected (1)'))

      // Only the DRAFT plan's selection is cleared after approving; the already-published
      // plan that was also checked stays selected.
      await waitFor(() => {
        expect(screen.getByText('1 selected')).toBeInTheDocument()
      })
      expect(screen.getByText('Approve Selected (0)')).toBeInTheDocument()
    })

    it('bulk delete removes the selected plans after confirmation', async () => {
      const { container } = renderWithProviders(<LessonPlansPage />)
      selectClass1()
      applyDateRange(container)
      await waitFor(() => {
        expect(screen.getAllByText('Introduction to Algebra').length).toBeGreaterThanOrEqual(1)
      }, WAIT_OPTS)

      const table = container.querySelector('table')
      fireEvent.click(table.querySelectorAll('tbody input[type="checkbox"]')[0])
      fireEvent.click(screen.getByText('Delete Selected (1)'))

      await waitFor(() => {
        expect(screen.getByText('Delete Lesson Plans')).toBeInTheDocument()
      })
      const deleteButtons = screen.getAllByRole('button', { name: 'Delete' })
      fireEvent.click(deleteButtons[deleteButtons.length - 1])

      await waitFor(() => {
        expect(screen.queryByText('Delete Lesson Plans')).not.toBeInTheDocument()
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
        expect(screen.getByText(/No lesson plans yet/)).toBeInTheDocument()
      }, WAIT_OPTS)
    })
  })
})
