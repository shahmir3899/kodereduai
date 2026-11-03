import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import CurriculumCoveragePage from './CurriculumCoveragePage'
import TopicStatusBadge from './TopicStatusBadge'
import ScheduleStatusBadge from './ScheduleStatusBadge'

// vi.mock factories are hoisted above imports, so the mock has to be too.
const mockLmsApi = vi.hoisted(() => ({
  getTopics: vi.fn(),
  setTopicPlannedDate: vi.fn(),
}))

vi.mock('../../services/api', () => ({
  lmsApi: mockLmsApi,
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isTeacher: false, user: { id: 1, role: 'SCHOOL_ADMIN' } }),
}))

vi.mock('../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ activeAcademicYear: { id: 1, name: '2025-2026' } }),
}))

vi.mock('../../components/Toast', () => ({
  useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }),
}))

vi.mock('../../hooks/useSessionClasses', () => ({
  useSessionClasses: () => ({ sessionClasses: [{ id: 101, class_obj: 1 }] }),
}))

vi.mock('../../hooks/useClassSubjects', () => ({
  useClassSubjects: () => ({
    subjects: [{ id: 1, name: 'Mathematics', code: 'MATH' }],
    isLoading: false,
  }),
}))

vi.mock('../../hooks/useTeacherScopedClasses', () => ({
  default: () => ({ showAllOption: false, classOptions: null }),
}))

vi.mock('../../utils/classScope', () => ({
  getClassSelectorScope: () => 'master',
  getResolvedMasterClassId: (value) => value,
}))

vi.mock('../../components/ClassSelector', () => ({
  default: ({ value, onChange }) => (
    <select data-testid="class-selector" value={value} onChange={onChange}>
      <option value="">Select class</option>
      <option value="1">Class 10</option>
    </select>
  ),
}))

vi.mock('./CurriculumTimeline', () => ({ default: () => <div>Timeline</div> }))

const mockTopics = [
  {
    id: 1, topic_number: 1.1, title: 'Introduction to Algebra',
    is_covered: true, is_tested: true, lesson_plan_count: 2, test_question_count: 5,
    planned_date: '2025-09-10', taught_date: '2025-09-08',
    coverage_status: 'on_time', coverage_days: 0,
  },
  {
    id: 2, topic_number: 1.2, title: 'Linear Equations',
    is_covered: true, is_tested: false, lesson_plan_count: 1, test_question_count: 0,
    planned_date: '2025-09-10', taught_date: '2025-09-13',
    coverage_status: 'late', coverage_days: 3,
  },
  {
    id: 3, topic_number: 1.3, title: 'Quadratic Equations',
    is_covered: false, is_tested: true, lesson_plan_count: 0, test_question_count: 3,
    planned_date: '2025-09-20', taught_date: null,
    coverage_status: 'overdue', coverage_days: 4,
  },
  {
    id: 4, topic_number: 1.4, title: 'Polynomials',
    is_covered: false, is_tested: false, lesson_plan_count: 0, test_question_count: 0,
    planned_date: null, taught_date: null,
    coverage_status: 'not_planned', coverage_days: 0,
  },
]

const renderComponent = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <CurriculumCoveragePage />
      </BrowserRouter>
    </QueryClientProvider>
  )
}

const selectClassAndSubject = () => {
  fireEvent.change(screen.getByTestId('class-selector'), { target: { value: '1' } })
  fireEvent.change(screen.getByDisplayValue('Select subject...'), { target: { value: '1' } })
}

describe('CurriculumCoveragePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLmsApi.getTopics.mockResolvedValue({ data: { results: mockTopics } })
    mockLmsApi.setTopicPlannedDate.mockResolvedValue({ data: {} })
  })

  describe('Filter UI', () => {
    it('renders class, subject, coverage and schedule filters', () => {
      renderComponent()

      expect(screen.getByTestId('class-selector')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Select class first')).toBeInTheDocument()
      expect(screen.getByDisplayValue('All topics')).toBeInTheDocument()
      expect(screen.getByDisplayValue('All schedules')).toBeInTheDocument()
    })

    it('offers every coverage and schedule option', () => {
      renderComponent()

      for (const name of ['Taught only', 'Tested only', 'Taught & tested', 'Uncovered']) {
        expect(screen.getByRole('option', { name })).toBeInTheDocument()
      }
      for (const name of ['Overdue', 'Taught late', 'Taught on time', 'Upcoming', 'Not planned']) {
        expect(screen.getByRole('option', { name })).toBeInTheDocument()
      }
    })
  })

  describe('Data Loading', () => {
    it('shows message when no class/subject selected', () => {
      renderComponent()
      expect(screen.getByText('Select class and subject to view coverage.')).toBeInTheDocument()
    })

    it('fetches topics scoped to the academic year once class and subject are chosen', async () => {
      renderComponent()
      selectClassAndSubject()

      await waitFor(() => {
        expect(mockLmsApi.getTopics).toHaveBeenCalledWith({
          page_size: 999,
          class_id: '1',
          subject_id: '1',
          academic_year: 1,
        })
      })
    })

    it('sends the coverage param when the coverage filter is set', async () => {
      renderComponent()
      selectClassAndSubject()
      await waitFor(() => expect(mockLmsApi.getTopics).toHaveBeenCalled())

      fireEvent.change(screen.getByDisplayValue('All topics'), { target: { value: 'taught_only' } })

      await waitFor(() => {
        expect(mockLmsApi.getTopics).toHaveBeenCalledWith({
          page_size: 999,
          class_id: '1',
          subject_id: '1',
          coverage: 'taught_only',
          academic_year: 1,
        })
      })
    })

    it('sends coverage_status when the schedule filter is set', async () => {
      renderComponent()
      selectClassAndSubject()
      await waitFor(() => expect(mockLmsApi.getTopics).toHaveBeenCalled())

      fireEvent.change(screen.getByDisplayValue('All schedules'), { target: { value: 'late' } })

      await waitFor(() => {
        expect(mockLmsApi.getTopics).toHaveBeenCalledWith({
          page_size: 999,
          class_id: '1',
          subject_id: '1',
          coverage_status: 'late',
          academic_year: 1,
        })
      })
    })

    it('shows loading state while fetching', async () => {
      mockLmsApi.getTopics.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ data: { results: mockTopics } }), 100))
      )

      renderComponent()
      selectClassAndSubject()

      expect(await screen.findByText('Loading topics...')).toBeInTheDocument()
    })

    it('shows empty message when no topics found', async () => {
      mockLmsApi.getTopics.mockResolvedValue({ data: { results: [] } })

      renderComponent()
      selectClassAndSubject()

      expect(await screen.findByText('No topics found for selected filters.')).toBeInTheDocument()
    })

    it('does not fetch until both class and subject are selected', async () => {
      renderComponent()
      fireEvent.change(screen.getByTestId('class-selector'), { target: { value: '1' } })

      await new Promise((r) => setTimeout(r, 100))

      expect(mockLmsApi.getTopics).not.toHaveBeenCalled()
    })
  })

  describe('Metrics Display', () => {
    it('counts taught, tested, late and overdue topics', async () => {
      renderComponent()
      selectClassAndSubject()

      await screen.findByText('1.1. Introduction to Algebra')
      // Labels like "Overdue" also appear as filter options, so match the tile's <p>.
      const tile = (label) => screen.getByText(label, { selector: 'p' }).closest('div')

      expect(tile('Total Topics')).toHaveTextContent('4')
      expect(tile('Taught')).toHaveTextContent('2') // is_covered: topics 1, 2
      expect(tile('Tested')).toHaveTextContent('2') // is_tested: topics 1, 3
      expect(tile('Taught Late')).toHaveTextContent('1')
      expect(tile('Overdue')).toHaveTextContent('1')
    })
  })

  describe('Topic List Display', () => {
    it('displays topic numbers and titles', async () => {
      renderComponent()
      selectClassAndSubject()

      expect(await screen.findByText('1.1. Introduction to Algebra')).toBeInTheDocument()
      expect(screen.getByText('1.2. Linear Equations')).toBeInTheDocument()
      expect(screen.getByText('1.3. Quadratic Equations')).toBeInTheDocument()
      expect(screen.getByText('1.4. Polynomials')).toBeInTheDocument()
    })

    it('shows a schedule badge per topic, with days for late and overdue', async () => {
      renderComponent()
      selectClassAndSubject()

      expect(await screen.findByText('On time')).toBeInTheDocument()
      expect(screen.getByText('Late · 3d')).toBeInTheDocument()
      expect(screen.getByText('Overdue · 4d')).toBeInTheDocument()
      // The filter dropdown also has a "Not planned" option, so match the badge.
      expect(screen.getByText('Not planned', { selector: 'span' })).toBeInTheDocument()
    })

    it('saves a changed planned date for the active academic year', async () => {
      renderComponent()
      selectClassAndSubject()
      await screen.findByText('1.4. Polynomials')

      // Polynomials is the only topic with no planned date.
      const input = Array.from(document.querySelectorAll('input[type="date"]')).find((i) => i.value === '')
      fireEvent.change(input, { target: { value: '2025-10-01' } })
      fireEvent.blur(input)

      await waitFor(() => {
        expect(mockLmsApi.setTopicPlannedDate).toHaveBeenCalledWith(4, {
          academicYear: 1,
          plannedDate: '2025-10-01',
        })
      })
    })
  })

  describe('Topic Status Badge', () => {
    it('renders correct badge for taught & tested topic', () => {
      render(<TopicStatusBadge topic={mockTopics[0]} />)
      expect(screen.getByText('Taught & Tested')).toHaveClass('bg-green-100', 'text-green-700')
    })

    it('renders correct badge for taught only topic', () => {
      render(<TopicStatusBadge topic={mockTopics[1]} />)
      expect(screen.getByText('Taught only')).toHaveClass('bg-amber-100', 'text-amber-700')
    })

    it('renders correct badge for tested only topic', () => {
      render(<TopicStatusBadge topic={mockTopics[2]} />)
      expect(screen.getByText('Tested only')).toHaveClass('bg-blue-100', 'text-blue-700')
    })

    it('renders correct badge for uncovered topic', () => {
      render(<TopicStatusBadge topic={mockTopics[3]} />)
      expect(screen.getByText('Not covered')).toHaveClass('bg-gray-100', 'text-gray-600')
    })

    it('returns null for missing topic', () => {
      const { container } = render(<TopicStatusBadge topic={null} />)
      expect(container.firstChild).toBeNull()
    })
  })

  describe('Schedule Status Badge', () => {
    it('styles late and overdue and appends the day count', () => {
      const { rerender } = render(<ScheduleStatusBadge topic={mockTopics[1]} />)
      expect(screen.getByText('Late · 3d')).toHaveClass('bg-amber-100', 'text-amber-700')

      rerender(<ScheduleStatusBadge topic={mockTopics[2]} />)
      expect(screen.getByText('Overdue · 4d')).toHaveClass('bg-red-100', 'text-red-700')
    })

    it('renders nothing without a coverage status (no academic year in scope)', () => {
      const { container } = render(<ScheduleStatusBadge topic={{ coverage_status: null }} />)
      expect(container.firstChild).toBeNull()
    })
  })
})
