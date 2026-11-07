import { describe, expect, it } from 'vitest'
import { buildReview, changeQuestionType, missingBeforeSave, pageDisplayStatus, parseDurationMinutes, snippet } from '../paperCaptureLogic'

const result = {
  header: { exam_title: 'Mid', detected_total_marks: 8, duration_label: '1.5 hours', class_label: 'FIFTH' },
  sections: [
    {
      title: 'Objective', instruction: null, question_type_guess: 'MCQ', marks_per_question: 2, shown_count: 3, counted_count: 3,
      questions: [1, 2, 3].map((n) => ({ question_text: `<p>q${n}</p>`, question_type: 'MCQ', marks: 2, options: { A: 'a' }, needs_review: n === 3 })),
    },
    {
      title: 'Attempt any 1', instruction: 'Attempt any 1', question_type_guess: 'SHORT', marks_per_question: 4, shown_count: 2, counted_count: 1,
      questions: [1, 2].map((n) => ({ question_text: `s${n}`, question_type: 'SHORT', marks: 4 })),
    },
  ],
}

describe('buildReview', () => {
  it('turns the reconciled paper into structure rows, slotted questions and paper fields', () => {
    const review = buildReview(result)
    expect(review.structure.map((s) => [s.title, s.question_type, s.slots_shown, s.slots_counted])).toEqual([
      ['Objective', 'MCQ', 3, 3], ['Attempt any 1', 'SHORT', 2, 1],
    ])
    expect(review.questions).toHaveLength(5)
    expect(review.questions[0].section_key).toBe(review.structure[0].key)
    expect(review.questions[2].needs_review).toBe(true)
    expect(review.paperFields).toEqual({ paper_title: 'Mid', total_marks: '8', duration_minutes: '90' })
  })

  it('leaves total marks empty when none was printed, so the user must fill it', () => {
    const review = buildReview({ header: {}, sections: [] })
    expect(review.paperFields.total_marks).toBe('')
    expect(missingBeforeSave({ paperFields: review.paperFields })).toEqual(['Paper title', 'Total marks'])
  })
})

describe('changeQuestionType', () => {
  it('splits a uniform section when one question becomes another type, keeping order', () => {
    const { structure, questions } = buildReview(result)
    const target = questions[2].local_id
    const next = changeQuestionType(structure, questions, target, 'TRUE_FALSE')
    expect(next.structure.map((s) => [s.question_type, s.slots_shown])).toEqual([['MCQ', 2], ['TRUE_FALSE', 1], ['SHORT', 2]])
    const third = next.questions.find((q) => q.local_id === target)
    expect(third.section_key).toBe(next.structure[1].key)
    expect(third.needs_review).toBe(false)
    expect(next.questions.map((q) => q.local_id)).toEqual(questions.map((q) => q.local_id))
  })

  it('keeps an "attempt any" section whole, because the choice spans all of it', () => {
    const { structure, questions } = buildReview(result)
    const next = changeQuestionType(structure, questions, questions[3].local_id, 'LONG')
    expect(next.structure).toBe(structure)
    expect(next.questions[3].question_type).toBe('LONG')
  })

  it('does nothing when the type is unchanged', () => {
    const { structure, questions } = buildReview(result)
    expect(changeQuestionType(structure, questions, questions[0].local_id, 'MCQ')).toEqual({ structure, questions })
  })
})

describe('small helpers', () => {
  it('parses durations', () => {
    expect(parseDurationMinutes('2 hours')).toBe(120)
    expect(parseDurationMinutes('45 min')).toBe(45)
    expect(parseDurationMinutes('')).toBeNull()
  })

  it('shortens question text to one plain line', () => {
    expect(snippet('<p>Hello <b>world</b></p>')).toBe('Hello world')
    expect(snippet('x'.repeat(200), 10)).toHaveLength(10)
  })

  it('merges local and server page state', () => {
    expect(pageDisplayStatus({ state: 'uploading' }, { status: 'EXTRACTED' })).toBe('uploading')
    expect(pageDisplayStatus(undefined, { status: 'MISSING' })).toBe('empty')
    expect(pageDisplayStatus({ state: 'failed' }, { status: 'MISSING' })).toBe('failed')
    expect(pageDisplayStatus(undefined, { status: 'PROCESSING' })).toBe('processing')
    expect(pageDisplayStatus(undefined, { status: 'FAILED' })).toBe('failed')
    expect(pageDisplayStatus(undefined, { status: 'EXTRACTED' })).toBe('extracted')
  })
})
