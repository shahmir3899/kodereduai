import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import QuestionPaperBuilderPage from '../QuestionPaperBuilderPage'
import { renderWithProviders } from '../../../test/utils'

const mockGetCoverageStats = vi.fn()

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useLocation: () => ({ state: {} }),
    useParams: () => ({ paperId: '1' }),
  }
})

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeSchool: { id: 1 }, user: { id: 1, role: 'SCHOOL_ADMIN' } }),
}))

vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ activeAcademicYear: { id: 1, name: '2025-2026' } }),
}))

vi.mock('../../../hooks/useSessionClasses', () => ({
  useSessionClasses: () => ({ sessionClasses: [{ id: 101, class_obj: 1 }] }),
}))

vi.mock('../../../hooks/useClassSubjects', () => ({
  useClassSubjects: () => ({ subjects: [{ id: 1, name: 'Science', code: 'SCI' }], isLoading: false }),
}))

vi.mock('../../../hooks/useTeacherScopedClasses', () => ({
  default: () => ({ showAllOption: false, classOptions: [{ id: 1, name: 'Class 1A' }] }),
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
        <option value="1">Class 1A</option>
      </select>
    )
  },
}))

vi.mock('../ImageCapturePaperTab', () => ({ default: () => <div>Image Tab</div> }))
vi.mock('../LessonPlanPaperTab', () => ({ default: () => <div>Lesson Tab</div> }))
vi.mock('../ManualEntryPaperTab', () => ({
  default: function MockManualEntryPaperTab({ draftData, onDraftDataChange }) {
    return (
      <div>
        <button
          type="button"
          onClick={() =>
            onDraftDataChange({
              ...draftData,
              questions: [...(draftData.questions || []), {
                local_id: 'new-q',
                question_text: 'Newly added',
                question_type: 'SHORT',
                difficulty_level: 'MEDIUM',
                marks: 2,
                bloom_level: 'apply',
              }],
            })
          }
        >
          Add Question
        </button>
      </div>
    )
  },
}))

vi.mock('../../../services/api', () => ({
  questionPaperApi: {
    getExamPaper: vi.fn().mockResolvedValue({
      data: {
        id: 1,
        status: 'DRAFT',
        class_obj: 1,
        subject: 1,
        exam: null,
        paper_title: 'Term Paper',
        instructions: 'Answer all',
        total_marks: 100,
        duration_minutes: 60,
        updated_at: '2026-05-25T00:00:00Z',
        paper_questions: [],
      },
    }),
    getCoverageStats: (...args) => mockGetCoverageStats(...args),
    createExamPaper: vi.fn().mockResolvedValue({ data: { id: 1 } }),
    ensureDraft: vi.fn().mockResolvedValue({ data: { id: 1 } }),
    autosaveDraft: vi.fn().mockResolvedValue({ data: { id: 1 } }),
  },
  examinationsApi: {
    getExams: vi.fn().mockResolvedValue({ data: { results: [] } }),
  },
  lmsApi: {
    getLessonPlan: vi.fn().mockResolvedValue({ data: { id: 21, planned_topics: [{ id: 101 }, { id: 102 }] } }),
    getTopicStandards: vi
      .fn()
      .mockImplementation((topicId) => {
        if (topicId === 101) {
          return Promise.resolve({ data: [{ id: 1, code: 'SLO-1', statement: 'Covered SLO' }] })
        }
        return Promise.resolve({ data: [{ id: 2, code: 'SLO-2', statement: 'Uncovered SLO' }] })
      }),
  },
}))

describe('SLO Coverage Panel in Paper Builder', () => {
  beforeEach(() => {
    mockGetCoverageStats.mockResolvedValue({
      data: {
        covered_topics: [{ id: 101, topic: 'Cells' }],
        linked_lesson_plans: [{ id: 21, title: 'Cells Plan' }],
        slo_coverage_count: 1,
      },
    })
  })

  it('coverage panel renders in paper builder', async () => {
    renderWithProviders(<QuestionPaperBuilderPage />)
    await waitFor(() => {
      expect(screen.getByText('Curriculum Coverage')).toBeInTheDocument()
    })
  })

  it('panel shows total and covered SLO counts', async () => {
    renderWithProviders(<QuestionPaperBuilderPage />)

    await waitFor(() => {
      expect(screen.getByText('Total SLOs')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
      expect(screen.getByText('Covered')).toBeInTheDocument()
      expect(screen.getByText('1')).toBeInTheDocument()
    })
  })

  it('percentage bar present in panel', async () => {
    renderWithProviders(<QuestionPaperBuilderPage />)

    await waitFor(() => {
      expect(screen.getByText('50%')).toBeInTheDocument()
    })
  })

  it('panel updates when question is added', async () => {
    const user = userEvent.setup()
    renderWithProviders(<QuestionPaperBuilderPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Question' })).toBeInTheDocument()
    })
    const callsBefore = mockGetCoverageStats.mock.calls.length

    await user.click(screen.getByRole('button', { name: 'Add Question' }))

    await waitFor(() => {
      expect(mockGetCoverageStats.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })

  it('covered SLOs shown with green checkmark', async () => {
    renderWithProviders(<QuestionPaperBuilderPage />)

    await waitFor(() => {
      expect(screen.getByText(/SLO-1 Covered SLO/)).toBeInTheDocument()
    })
  })

  it('uncovered SLOs shown in grey', async () => {
    renderWithProviders(<QuestionPaperBuilderPage />)

    await waitFor(() => {
      expect(screen.getByText(/SLO-2 Uncovered SLO/)).toBeInTheDocument()
    })
  })

  it('panel can be collapsed and expanded', async () => {
    const user = userEvent.setup()
    renderWithProviders(<QuestionPaperBuilderPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: 'Collapse' }))

    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument()
    expect(screen.queryByText('Covered SLOs')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand' }))
    await waitFor(() => {
      expect(screen.getByText('Covered SLOs')).toBeInTheDocument()
    })
  })
})
