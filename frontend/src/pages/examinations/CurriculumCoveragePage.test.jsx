import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import CurriculumCoveragePage from './CurriculumCoveragePage'
import TopicStatusBadge from './TopicStatusBadge'

// Mock lmsApi
const mockLmsApi = {
  getTopics: vi.fn()
}

vi.mock('../../services/api', () => ({
  lmsApi: mockLmsApi
}))

// Mock components
vi.mock('../../components/ClassSelector', () => ({
  default: ({ value, onChange }) => (
    <select data-testid="class-selector" value={value} onChange={onChange}>
      <option value="">Select class</option>
      <option value="1">Class 10</option>
      <option value="2">Class 11</option>
    </select>
  )
}))

vi.mock('../../components/SubjectSelector', () => ({
  default: ({ value, onChange }) => (
    <select data-testid="subject-selector" value={value} onChange={onChange}>
      <option value="">Select subject</option>
      <option value="1">Mathematics</option>
      <option value="2">Science</option>
    </select>
  )
}))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false }
  }
})

const mockTopics = [
  {
    id: 1,
    topic_number: 1.1,
    title: 'Introduction to Algebra',
    is_covered: true,
    is_tested: true,
    lesson_plan_count: 2,
    test_question_count: 5
  },
  {
    id: 2,
    topic_number: 1.2,
    title: 'Linear Equations',
    is_covered: true,
    is_tested: false,
    lesson_plan_count: 1,
    test_question_count: 0
  },
  {
    id: 3,
    topic_number: 1.3,
    title: 'Quadratic Equations',
    is_covered: false,
    is_tested: true,
    lesson_plan_count: 0,
    test_question_count: 3
  },
  {
    id: 4,
    topic_number: 1.4,
    title: 'Polynomials',
    is_covered: false,
    is_tested: false,
    lesson_plan_count: 0,
    test_question_count: 0
  }
]

const renderComponent = () => {
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <CurriculumCoveragePage />
      </BrowserRouter>
    </QueryClientProvider>
  )
}

describe('CurriculumCoveragePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLmsApi.getTopics.mockResolvedValue({ data: { results: mockTopics } })
  })

  describe('Filter UI', () => {
    it('renders class, subject, and coverage filter dropdowns', () => {
      renderComponent()
      
      expect(screen.getByTestId('class-selector')).toBeInTheDocument()
      expect(screen.getByTestId('subject-selector')).toBeInTheDocument()
      expect(screen.getByDisplayValue('All topics')).toBeInTheDocument()
    })

    it('displays coverage filter options', () => {
      renderComponent()
      
      const coverageSelect = screen.getByDisplayValue('All topics')
      expect(coverageSelect).toBeInTheDocument()
      
      // Check all options exist
      expect(screen.getByDisplayValue('All topics')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Taught only')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Tested only')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Taught & tested')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Uncovered')).toBeInTheDocument()
    })
  })

  describe('Data Loading', () => {
    it('shows message when no class/subject selected', () => {
      renderComponent()
      expect(screen.getByText('Select class and subject to view coverage.')).toBeInTheDocument()
    })

    it('triggers API call when class and subject are selected', async () => {
      renderComponent()
      
      fireEvent.change(screen.getByTestId('class-selector'), { target: { value: '1' } })
      fireEvent.change(screen.getByTestId('subject-selector'), { target: { value: '1' } })
      
      await waitFor(() => {
        expect(mockLmsApi.getTopics).toHaveBeenCalledWith({
          page_size: 999,
          class_id: '1',
          subject_id: '1'
        })
      })
    })

    it('includes coverage param when coverage filter is set', async () => {
      renderComponent()
      
      fireEvent.change(screen.getByTestId('class-selector'), { target: { value: '1' } })
      fireEvent.change(screen.getByTestId('subject-selector'), { target: { value: '1' } })
      
      await waitFor(() => {
        expect(mockLmsApi.getTopics).toHaveBeenCalled()
      })
      
      vi.clearAllMocks()
      mockLmsApi.getTopics.mockResolvedValue({ data: { results: [] } })
      
      fireEvent.change(screen.getByDisplayValue('All topics'), { target: { value: 'taught_only' } })
      
      await waitFor(() => {
        expect(mockLmsApi.getTopics).toHaveBeenCalledWith({
          page_size: 999,
          class_id: '1',
          subject_id: '1',
          coverage: 'taught_only'
        })
      })
    })

    it('shows loading state while fetching', () => {
      mockLmsApi.getTopics.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ data: { results: mockTopics } }), 100))
      )
      
      renderComponent()
      fireEvent.change(screen.getByTestId('class-selector'), { target: { value: '1' } })
      fireEvent.change(screen.getByTestId('subject-selector'), { target: { value: '1' } })
      
      expect(screen.getByText('Loading topics...')).toBeInTheDocument()
    })

    it('shows empty message when no topics found', async () => {
      mockLmsApi.getTopics.mockResolvedValue({ data: { results: [] } })
      
      renderComponent()
      fireEvent.change(screen.getByTestId('class-selector'), { target: { value: '1' } })
      fireEvent.change(screen.getByTestId('subject-selector'), { target: { value: '1' } })
      
      await waitFor(() => {
        expect(screen.getByText('No topics found for selected filters.')).toBeInTheDocument()
      })
    })
  })

  describe('Metrics Display', () => {
    it('calculates and displays taught and tested counts', async () => {
      renderComponent()
      
      fireEvent.change(screen.getByTestId('class-selector'), { target: { value: '1' } })
      fireEvent.change(screen.getByTestId('subject-selector'), { target: { value: '1' } })
      
      await waitFor(() => {
        // Total should be 4
        expect(screen.getByText('Total Topics')).toBeInTheDocument()
        
        // Taught (is_covered=true): topics 1, 2 = 2
        const taughtCard = screen.getAllByText('Taught')[0].closest('div').parentElement
        expect(taughtCard).toHaveTextContent('2')
        
        // Tested (is_tested=true): topics 1, 3 = 2
        const testedCard = screen.getAllByText('Tested')[0].closest('div').parentElement
        expect(testedCard).toHaveTextContent('2')
      })
    })
  })

  describe('Topic List Display', () => {
    it('displays topics in a table with columns', async () => {
      renderComponent()
      
      fireEvent.change(screen.getByTestId('class-selector'), { target: { value: '1' } })
      fireEvent.change(screen.getByTestId('subject-selector'), { target: { value: '1' } })
      
      await waitFor(() => {
        expect(screen.getByText('Topic')).toBeInTheDocument()
        expect(screen.getByText('Status')).toBeInTheDocument()
        expect(screen.getByText('Lesson Plans')).toBeInTheDocument()
        expect(screen.getByText('Questions')).toBeInTheDocument()
      })
    })

    it('displays topic numbers and titles', async () => {
      renderComponent()
      
      fireEvent.change(screen.getByTestId('class-selector'), { target: { value: '1' } })
      fireEvent.change(screen.getByTestId('subject-selector'), { target: { value: '1' } })
      
      await waitFor(() => {
        expect(screen.getByText('1.1. Introduction to Algebra')).toBeInTheDocument()
        expect(screen.getByText('1.2. Linear Equations')).toBeInTheDocument()
        expect(screen.getByText('1.3. Quadratic Equations')).toBeInTheDocument()
        expect(screen.getByText('1.4. Polynomials')).toBeInTheDocument()
      })
    })

    it('displays lesson plan and question counts', async () => {
      renderComponent()
      
      fireEvent.change(screen.getByTestId('class-selector'), { target: { value: '1' } })
      fireEvent.change(screen.getByTestId('subject-selector'), { target: { value: '1' } })
      
      await waitFor(() => {
        const rows = screen.getAllByText(/\d+\.\d+\./); // Topic rows
        expect(rows.length).toBe(4)
        
        // Check lesson plan counts: 2, 1, 0, 0
        expect(screen.getAllByText('2')[1]).toBeInTheDocument()
        expect(screen.getAllByText('1')[1]).toBeInTheDocument()
      })
    })
  })

  describe('Topic Status Badge', () => {
    it('renders correct badge for taught & tested topic', () => {
      const topic = mockTopics[0]
      const { container } = render(<TopicStatusBadge topic={topic} />)
      
      expect(screen.getByText('Taught & Tested')).toHaveClass('bg-green-100', 'text-green-700')
    })

    it('renders correct badge for taught only topic', () => {
      const topic = mockTopics[1]
      const { container } = render(<TopicStatusBadge topic={topic} />)
      
      expect(screen.getByText('Taught only')).toHaveClass('bg-amber-100', 'text-amber-700')
    })

    it('renders correct badge for tested only topic', () => {
      const topic = mockTopics[2]
      const { container } = render(<TopicStatusBadge topic={topic} />)
      
      expect(screen.getByText('Tested only')).toHaveClass('bg-blue-100', 'text-blue-700')
    })

    it('renders correct badge for uncovered topic', () => {
      const topic = mockTopics[3]
      const { container } = render(<TopicStatusBadge topic={topic} />)
      
      expect(screen.getByText('Not covered')).toHaveClass('bg-gray-100', 'text-gray-600')
    })

    it('returns null for missing topic', () => {
      const { container } = render(<TopicStatusBadge topic={null} />)
      
      expect(container.firstChild).toBeNull()
    })
  })

  describe('Filter Interactions', () => {
    it('triggers refetch when coverage filter changes', async () => {
      renderComponent()
      
      fireEvent.change(screen.getByTestId('class-selector'), { target: { value: '1' } })
      fireEvent.change(screen.getByTestId('subject-selector'), { target: { value: '1' } })
      
      await waitFor(() => {
        expect(mockLmsApi.getTopics).toHaveBeenCalled()
      })
      
      const firstCallCount = mockLmsApi.getTopics.mock.calls.length
      
      fireEvent.change(screen.getByDisplayValue('All topics'), { target: { value: 'taught_only' } })
      
      await waitFor(() => {
        expect(mockLmsApi.getTopics.mock.calls.length).toBeGreaterThan(firstCallCount)
      })
    })

    it('does not fetch when only class is selected', async () => {
      renderComponent()
      
      fireEvent.change(screen.getByTestId('class-selector'), { target: { value: '1' } })
      
      await new Promise(r => setTimeout(r, 100))
      
      expect(mockLmsApi.getTopics).not.toHaveBeenCalled()
    })

    it('does not fetch when only subject is selected', async () => {
      renderComponent()
      
      fireEvent.change(screen.getByTestId('subject-selector'), { target: { value: '1' } })
      
      await new Promise(r => setTimeout(r, 100))
      
      expect(mockLmsApi.getTopics).not.toHaveBeenCalled()
    })
  })
})
