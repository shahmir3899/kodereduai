import { describe, expect, it } from 'vitest'
import { formFromQuestion } from '../QuestionsPage'

// Paper Builder v2: a matching question made in the block editor before the fix was stored as text pairs; the question
// bank form must still open it with its pairs (it used to show two empty rows).
describe('question bank form: matching questions', () => {
  it('opens a text-pair question with its pairs', () => {
    const form = formFromQuestion({ question_type: 'MATCHING', question_text: 'Match.', type_data: { pairs: [{ left: 'Fish', right: 'Water' }, { left: 'Bird', right: 'Nest' }] } })
    expect(form.matching_left).toEqual(['Fish', 'Bird'])
    expect(form.matching_right).toEqual(['Water', 'Nest'])
    expect(form.matching_pairs).toEqual([{ left: 0, right: 0 }, { left: 1, right: 1 }])
  })

  it('opens a bank-shape question as before', () => {
    const form = formFromQuestion({ question_type: 'MATCHING', type_data: { left_items: ['a', 'b'], right_items: ['x', 'y'], pairs: [{ left: 0, right: 1 }, { left: 1, right: 0 }] } })
    expect(form.matching_left).toEqual(['a', 'b'])
    expect(form.matching_pairs).toEqual([{ left: 0, right: 1 }, { left: 1, right: 0 }])
  })
})
