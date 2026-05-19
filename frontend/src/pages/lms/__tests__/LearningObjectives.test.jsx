import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LessonPlanWizard from '../LessonPlanWizard'
import { render } from '@testing-library/react'

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: ({ queryKey }) => {
    const key = Array.isArray(queryKey) ? queryKey[0] : queryKey
    if (key === 'classSubjects') {
      return { data: { data: { results: [{ id: 1, subject: 1, subject_name: 'Science' }] } }, isLoading: false }
    }
    if (key === 'hrStaffTeachers') {
      return { data: { data: { results: [{ id: 1, full_name: 'Teacher One' }] } }, isLoading: false }
    }
    if (key === 'booksForClassSubject') {
      return { data: { data: [] }, isLoading: false }
    }
    return { data: undefined, isLoading: false }
  },
  useQueries: ({ queries }) => (queries || []).map(() => ({ data: { data: [] }, isLoading: false, isError: false })),
  useMutation: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({ data: { id: 999 } }),
    isPending: false,
  }),
}))

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeSchool: { id: 1 } }),
}))

vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({ activeAcademicYear: { id: 1 } }),
}))

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}))

vi.mock('../../../hooks/useSessionClasses', () => ({
  useSessionClasses: () => ({ sessionClasses: [{ id: 101, class_obj: 1 }] }),
}))

vi.mock('../../../utils/classScope', () => ({
  getClassSelectorScope: () => 'master',
  getResolvedMasterClassId: (value) => value,
}))

vi.mock('../../../components/ClassSelector', () => ({
  default: function MockClassSelector({ value, onChange }) {
    return (
      <select aria-label="Class" value={value} onChange={onChange}>
        <option value="">Select Class</option>
        <option value="1">Class 1A</option>
      </select>
    )
  },
}))

vi.mock('../LessonPlanAIModal', () => ({
  default: function MockLessonPlanAIModal({ isOpen, onAccept }) {
    if (!isOpen) return null
    return (
      <button
        type="button"
        onClick={() => onAccept({ objectives: '- Obj 1\n- Obj 2\n- Obj 3', title: 'AI Plan' })}
      >
        Apply AI Draft
      </button>
    )
  },
}))

vi.mock('../../../services/api', () => ({
  academicsApi: {
    getClassSubjects: vi.fn().mockResolvedValue({
      data: { results: [{ id: 1, subject: 1, subject_name: 'Science' }] },
    }),
  },
  hrApi: {
    getStaff: vi.fn().mockResolvedValue({
      data: { results: [{ id: 1, full_name: 'Teacher One' }] },
    }),
  },
  lmsApi: {
    getBooksForClassSubject: vi.fn().mockResolvedValue({ data: [] }),
    createLessonPlan: vi.fn().mockResolvedValue({ data: { id: 999 } }),
    updateLessonPlan: vi.fn().mockResolvedValue({ data: { id: 999 } }),
    linkLessonPlanObjectives: vi.fn().mockResolvedValue({ data: {} }),
    getTopicObjectives: vi.fn().mockResolvedValue({ data: [] }),
  },
}))

const renderWizard = (props = {}) => {
  const onClose = vi.fn()
  const onSuccess = vi.fn()
  render(<LessonPlanWizard onClose={onClose} onSuccess={onSuccess} {...props} />)
}

describe('Structured Learning Objectives Builder', () => {
  it('objective builder renders instead of plain textarea', async () => {
    renderWizard({ editingPlan: { id: 1, title: 'Plan', objectives: '', linked_objectives: [] } })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Objective' })).toBeInTheDocument()
    })
    expect(screen.queryByPlaceholderText('List lesson objectives...')).not.toBeInTheDocument()
  })

  it('Add Objective button appends a new row', async () => {
    const user = userEvent.setup()
    renderWizard({ editingPlan: { id: 1, title: 'Plan', objectives: '', linked_objectives: [] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Objective' })).toBeInTheDocument())

    const before = screen.getAllByPlaceholderText('Students will be able to...').length
    await user.click(screen.getByRole('button', { name: 'Add Objective' }))
    const after = screen.getAllByPlaceholderText('Students will be able to...').length

    expect(after).toBe(before + 1)
  })

  it('each objective row has bloom level select', async () => {
    renderWizard({ editingPlan: { id: 1, title: 'Plan', objectives: '', linked_objectives: [] } })
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0))

    const bloomSelect = screen.getAllByRole('combobox').find((node) =>
      node.querySelector('option[value="remember"]'),
    )
    expect(bloomSelect).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Remember' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Create' })).toBeInTheDocument()
  })

  it('remove button deletes objective row', async () => {
    const user = userEvent.setup()
    renderWizard({ editingPlan: { id: 1, title: 'Plan', objectives: '', linked_objectives: [] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Objective' })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Add Objective' }))
    const removeButtons = screen.getAllByTitle('Delete objective')
    const rowsBefore = screen.getAllByPlaceholderText('Students will be able to...').length
    await user.click(removeButtons[0])
    const rowsAfter = screen.getAllByPlaceholderText('Students will be able to...').length

    expect(rowsAfter).toBe(rowsBefore - 1)
  })

  it('AI generate button populates objectives list', async () => {
    const user = userEvent.setup()
    renderWizard({ editingPlan: { id: 1, title: 'Plan', objectives: '', linked_objectives: [] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Generate with AI' })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Generate with AI' }))
    await user.click(screen.getByRole('button', { name: 'Apply AI Draft' }))

    await waitFor(() => {
      const rows = screen.getAllByPlaceholderText('Students will be able to...')
      expect(rows.length).toBe(3)
    })
  })

  it('saved objectives display on lesson plan detail', async () => {
    renderWizard({
      editingPlan: {
        id: 1,
        title: 'Plan',
        linked_objectives: [
          { id: 10, statement: 'Explain photosynthesis', bloom_level: 'understand' },
          { id: 11, statement: 'Compare plant cells', bloom_level: 'analyze' },
        ],
      },
    })

    await waitFor(() => {
      expect(screen.getByDisplayValue('Explain photosynthesis')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Compare plant cells')).toBeInTheDocument()
    })
  })

  it('old plans with plain text objectives still render', async () => {
    renderWizard({
      editingPlan: {
        id: 1,
        title: 'Legacy Plan',
        objectives: '- Legacy objective one\n- Legacy objective two',
        linked_objectives: [],
      },
    })

    await waitFor(() => {
      expect(screen.getByDisplayValue('Legacy objective one')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Legacy objective two')).toBeInTheDocument()
    })
  })
})
