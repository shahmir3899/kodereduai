import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import QuestionPaperBuilderPage from '../QuestionPaperBuilderPage'
import { renderWithProviders } from '../../../test/utils'

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
// The block editor reports each save with the paper's questions; the chart is drawn from those.
vi.mock('../blocks/BlockPaperEditor', () => {
  const savedRow = (id, bloom, type = 'SHORT') => ({
    question: id, question_order: id, question_text: `q${id}`, question_type: type, difficulty_level: 'EASY',
    marks: 1, bloom_level: bloom || '', question_snapshot: {},
  })
  const base = [savedRow(1, 'apply'), savedRow(2, 'analyze')]
  return {
    default: function MockBlockPaperEditor({ onSaved }) {
      const save = (rows) => onSaved?.({ id: 1, total_marks: rows.length, overused_questions: [], paper_questions: rows })
      return (
        <div>
          <button type="button" onClick={() => save([...base, savedRow(3, 'remember')])}>Add Remember</button>
          <button type="button" onClick={() => save([...base, savedRow(4, '')])}>Add Unclassified</button>
          <button type="button" onClick={() => save([...base, savedRow(5, null, 'ACTIVITY')])}>Add Activity</button>
          <button
            type="button"
            onClick={() => save(['remember', 'remember', 'remember', 'remember', 'understand', 'understand', 'understand', 'apply']
              .map((bloom, i) => savedRow(10 + i, bloom)))}
          >
            Make Surface Heavy
          </button>
        </div>
      )
    },
  }
})

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
        paper_questions: [
          {
            question: 1,
            question_order: 1,
            question_text: 'Apply question',
            question_type: 'SHORT',
            difficulty_level: 'MEDIUM',
            marks: 2,
            bloom_level: 'apply',
            question_snapshot: {},
          },
          {
            question: 2,
            question_order: 2,
            question_text: 'Analyze question',
            question_type: 'SHORT',
            difficulty_level: 'MEDIUM',
            marks: 2,
            bloom_level: 'analyze',
            question_snapshot: {},
          },
        ],
      },
    }),
    getCoverageStats: vi.fn().mockResolvedValue({
      data: {
        covered_topics: [],
        linked_lesson_plans: [],
        slo_coverage_count: 0,
      },
    }),
    createExamPaper: vi.fn().mockResolvedValue({ data: { id: 1 } }),
    ensureDraft: vi.fn().mockResolvedValue({ data: { id: 1 } }),
    autosaveDraft: vi.fn().mockImplementation((id, data) => Promise.resolve({
      data: {
        id,
        status: 'DRAFT',
        paper_questions: (data.manual_questions || []).map((q, idx) => ({
          question: q.question_id || 9000 + idx,
          question_order: q.question_order || idx + 1,
          question_text: q.question_text,
          question_type: q.question_type,
          difficulty_level: q.difficulty_level,
          marks: q.marks,
          bloom_level: q.bloom_level,
          section_key: q.section_key || '',
          question_snapshot: { bloom_level: q.bloom_level },
        })),
      },
    })),
  },
  examinationsApi: {
    getExams: vi.fn().mockResolvedValue({ data: { results: [] } }),
  },
  lmsApi: {
    getLessonPlan: vi.fn().mockResolvedValue({ data: { planned_topics: [] } }),
    getTopicStandards: vi.fn().mockResolvedValue({ data: [] }),
  },
}))

describe('Bloom Distribution Chart in Paper Builder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('bloom chart renders in paper builder', async () => {
    renderWithProviders(<QuestionPaperBuilderPage />)
    await waitFor(() => {
      expect(screen.getByText('Bloom Distribution')).toBeInTheDocument()
    })
  })

  it('chart shows correct percentage per bloom level', async () => {
    renderWithProviders(<QuestionPaperBuilderPage />)
    await waitFor(() => {
      expect(screen.getByText('Apply (1)')).toBeInTheDocument()
      expect(screen.getByText('Analyze (1)')).toBeInTheDocument()
    })
  })

  it('chart updates when question added or removed', async () => {
    const user = userEvent.setup()
    renderWithProviders(<QuestionPaperBuilderPage />)

    await waitFor(() => {
      expect(screen.getByText('Remember (0)')).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: 'Add Remember' }))

    await waitFor(() => {
      expect(screen.getByText('Remember (1)')).toBeInTheDocument()
    })
  })

  it('unclassified segment shown for questions without bloom_level', async () => {
    const user = userEvent.setup()
    renderWithProviders(<QuestionPaperBuilderPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Unclassified' })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: 'Add Unclassified' }))
    await waitFor(() => {
      expect(screen.getByText('Unclassified (1)')).toBeInTheDocument()
    })
  })

  it('warning shown when paper is over 70% remember or understand', async () => {
    const user = userEvent.setup()
    renderWithProviders(<QuestionPaperBuilderPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Make Surface Heavy' })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: 'Make Surface Heavy' }))
    await waitFor(() => {
      expect(screen.getByText(/Warning:/)).toBeInTheDocument()
    })
  })

  it('drawing activities are left out of the chart', async () => {
    const user = userEvent.setup()
    renderWithProviders(<QuestionPaperBuilderPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Activity' })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Add Activity' }))
    await waitFor(() => {
      expect(screen.getByText('Unclassified (0)')).toBeInTheDocument()
      expect(screen.getByText('Apply (1)')).toBeInTheDocument()
    })
  })

  it('chart colors match bloom badge colors', async () => {
    renderWithProviders(<QuestionPaperBuilderPage />)
    await waitFor(() => {
      const marker = screen.getByText('Apply (1)').querySelector('span.w-2.h-2')
      expect(marker).toBeInTheDocument()
      expect(marker).toHaveStyle({ backgroundColor: '#16A34A' })
    })
  })
})
