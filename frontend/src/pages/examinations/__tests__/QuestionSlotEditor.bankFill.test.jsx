import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../../test/utils'
import QuestionSlotEditor from '../QuestionSlotEditor'

vi.mock('../../../components/RichTextEditor', () => ({ default: () => <div /> }))

const bankRows = [1, 2, 3, 4].map((id) => ({
  id, question_text: `Bank question ${id}`, question_type: 'SHORT', difficulty_level: 'EASY', marks: 2,
}))
const getQuestions = vi.fn(() => Promise.resolve({ data: { results: bankRows } }))
const getQuestionsByTopics = vi.fn(() => Promise.resolve({ data: { results: bankRows.slice(0, 2) } }))
const getLessonPlans = vi.fn(() => Promise.resolve({
  data: { results: [{ id: 7, title: 'Cells', planned_topics: [{ id: 70 }] }] },
}))
vi.mock('../../../services/api', () => ({
  questionPaperApi: {
    createQuestion: vi.fn(), uploadQuestionDiagram: vi.fn(), removeQuestionDiagram: vi.fn(),
    getQuestions: (...a) => getQuestions(...a), getQuestionsByTopics: (...a) => getQuestionsByTopics(...a),
  },
  lmsApi: { getLessonPlans: (...a) => getLessonPlans(...a) },
}))

const section = { key: 's1', type: 'question_group', title: 'Q1', instruction: '', question_type: 'SHORT', slots_shown: 3, slots_counted: 3, marks_per_question: 2 }

function setup(extra = {}) {
  const onDraftDataChange = vi.fn()
  renderWithProviders(
    <QuestionSlotEditor
      draftData={{ questions: [] }} onDraftDataChange={onDraftDataChange} onSubmitDraft={vi.fn()} isLoading={false}
      saveState="idle" draftReady classId={1} subjectId={2} structure={[section]} hideFooter {...extra}
    />,
  )
  return { onDraftDataChange }
}

describe('slot board: write or fill from bank on every slot', () => {
  it('offers Write and From bank on each empty slot, with no source chooser', () => {
    setup()
    expect(screen.getAllByText('Write')).toHaveLength(3)
    expect(screen.getAllByText('From bank')).toHaveLength(3)
    expect(screen.queryByText('Change source')).toBeNull()
  })

  it('fills several free slots at once and stops at the number of free slots', async () => {
    const { onDraftDataChange } = setup({ draftData: { questions: [{ local_id: 'a', section_key: 's1', question_type: 'SHORT', marks: 2, question_text: 'x' }] } })
    fireEvent.click(screen.getByText('Fill from bank (2 free)'))
    await screen.findByText('Bank question 1')
    expect(screen.getByText('Select up to 2 questions; they fill the empty slots in order.')).toBeTruthy()
    const boxes = screen.getAllByRole('checkbox')
    boxes.slice(0, 3).forEach((box) => fireEvent.click(box))
    expect(screen.getByText('2 selected of 2 slots')).toBeTruthy()
    expect(boxes[2].disabled).toBe(true)
    fireEvent.click(screen.getByText('Attach Selected'))
    const next = onDraftDataChange.mock.calls.pop()[0].questions
    expect(next).toHaveLength(3)
    expect(next.slice(1).map((q) => [q.question_id, q.section_key, q.marks])).toEqual([[1, 's1', 2], [2, 's1', 2]])
  })

  it('narrows the bank by the chosen lesson plans inside the picker', async () => {
    const onLessonPlanIdsChange = vi.fn()
    setup({ lessonPlanIds: [7], onLessonPlanIdsChange })
    fireEvent.click(screen.getAllByText('From bank')[0])
    await screen.findByText('Narrow by lesson plans (1 selected)', { exact: false })
    await waitFor(() => expect(getQuestionsByTopics).toHaveBeenCalledWith([70], expect.any(Object)))
    fireEvent.click(screen.getByText(/Narrow by lesson plans/))
    fireEvent.click(await screen.findByLabelText(/Cells/))
    expect(onLessonPlanIdsChange).toHaveBeenCalledWith([])
  })
})
