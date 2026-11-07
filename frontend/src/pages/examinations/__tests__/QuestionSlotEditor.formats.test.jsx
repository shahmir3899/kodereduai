import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '../../../test/utils'
import QuestionSlotEditor from '../QuestionSlotEditor'

// The rich editor is not what is under test: a plain textarea stands in for it.
vi.mock('../../../components/RichTextEditor', () => ({
  default: ({ value, onChange }) => (
    <textarea aria-label="question text" value={value || ''} onChange={(e) => onChange(`<p>${e.target.value}</p>`)} />
  ),
}))
vi.mock('../../../services/api', () => ({
  questionPaperApi: { createQuestion: vi.fn(), uploadQuestionDiagram: vi.fn(), removeQuestionDiagram: vi.fn() },
}))

const section = (type, extra = {}) => ({
  key: `s_${type}`, type: 'question_group', title: `Q ${type}`, instruction: '', question_type: type,
  slots_shown: 1, slots_counted: 1, marks_per_question: 2, ...extra,
})

function setup(structure, questions = []) {
  const onDraftDataChange = vi.fn()
  const view = renderWithProviders(
    <QuestionSlotEditor
      draftData={{ questions }} onDraftDataChange={onDraftDataChange} onSubmitDraft={vi.fn()} isLoading={false}
      saveState="idle" draftReady classId={1} subjectId={2} structure={structure} hideFooter
    />,
  )
  return { onDraftDataChange, ...view }
}

const typeQuestion = (text) => fireEvent.change(screen.getByLabelText('question text'), { target: { value: text } })
const saved = (spy) => spy.mock.calls.pop()[0].questions[0]

describe('QuestionSlotEditor saves the formats the server accepts', () => {
  it('saves a matching question as left_items, right_items and index pairs', () => {
    const { onDraftDataChange } = setup([section('MATCHING')])
    fireEvent.click(screen.getByText('Write'))
    typeQuestion('Match the animals.')
    fireEvent.click(screen.getByText('+ Add Pair'))
    fireEvent.click(screen.getByText('+ Add Pair'))
    const lefts = screen.getAllByPlaceholderText('Left')
    const rights = screen.getAllByPlaceholderText('Right')
    fireEvent.change(lefts[0], { target: { value: 'Fish' } }); fireEvent.change(rights[0], { target: { value: 'Water' } })
    fireEvent.change(lefts[1], { target: { value: 'Bird' } }); fireEvent.change(rights[1], { target: { value: 'Nest' } })
    fireEvent.click(screen.getByText('Add Question'))
    expect(saved(onDraftDataChange).type_data).toEqual({
      left_items: ['Fish', 'Bird'], right_items: ['Water', 'Nest'], pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }],
    })
  })

  it('asks for two complete pairs, the server rule, and does not save with one', () => {
    const { onDraftDataChange } = setup([section('MATCHING')])
    fireEvent.click(screen.getByText('Write'))
    typeQuestion('Match.')
    fireEvent.click(screen.getByText('+ Add Pair'))
    fireEvent.change(screen.getByPlaceholderText('Left'), { target: { value: 'Fish' } })
    fireEvent.change(screen.getByPlaceholderText('Right'), { target: { value: 'Water' } })
    fireEvent.click(screen.getByText('Add Question'))
    expect(screen.getByText('Add at least two complete pairs.')).toBeInTheDocument()
    expect(onDraftDataChange).not.toHaveBeenCalled()
  })

  it('reopens a saved matching question as text pairs and keeps an unmatched item on save', () => {
    const existing = {
      local_id: 'q1', question_id: 7, section_key: 's_MATCHING', question_text: '<p>Match.</p>', question_type: 'MATCHING', marks: 2,
      type_data: { left_items: ['Fish', 'Bird'], right_items: ['Nest', 'Water', 'Cave'], pairs: [{ left: 0, right: 1 }, { left: 1, right: 0 }] },
    }
    const { onDraftDataChange } = setup([section('MATCHING')], [existing])
    fireEvent.click(screen.getByText('Edit'))
    expect(screen.getAllByPlaceholderText('Left').map((i) => i.value)).toEqual(['Fish', 'Bird'])
    expect(screen.getAllByPlaceholderText('Right').map((i) => i.value)).toEqual(['Water', 'Nest'])
    fireEvent.click(screen.getByText('Save Question'))
    expect(saved(onDraftDataChange).type_data).toEqual({
      left_items: ['Fish', 'Bird'], right_items: ['Water', 'Nest', 'Cave'], pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }],
    })
  })

  it('saves true/false as TRUE or FALSE', () => {
    const { onDraftDataChange } = setup([section('TRUE_FALSE')])
    fireEvent.click(screen.getByText('Write'))
    typeQuestion('The sun is a star.')
    fireEvent.click(screen.getByLabelText('True'))
    fireEvent.click(screen.getByText('Add Question'))
    expect(saved(onDraftDataChange).correct_answer).toBe('TRUE')
  })

  it('reads an older lowercase answer and saves it as uppercase', () => {
    const existing = {
      local_id: 'q2', question_id: 8, section_key: 's_TRUE_FALSE', question_text: '<p>x</p>', question_type: 'TRUE_FALSE', marks: 2, correct_answer: 'false', type_data: {},
    }
    const { onDraftDataChange } = setup([section('TRUE_FALSE')], [existing])
    fireEvent.click(screen.getByText('Edit'))
    expect(screen.getByLabelText('False')).toBeChecked()
    fireEvent.click(screen.getByText('Save Question'))
    expect(saved(onDraftDataChange).correct_answer).toBe('FALSE')
  })
})
