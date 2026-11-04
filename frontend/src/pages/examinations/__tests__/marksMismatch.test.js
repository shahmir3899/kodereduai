import { describe, expect, it } from 'vitest'
import { marksMismatch } from '../paperPayload'

const section = (marks, shown = 5, counted = shown) => ({ type: 'question_group', slots_shown: shown, slots_counted: counted, marks_per_question: marks })

describe('marksMismatch (step 2 -> 3 warning)', () => {
  it('warns when the sections add up to something other than the typed total', () => {
    expect(marksMismatch([section(1)], '100')).toEqual({ allocated: 5, total: 100 })
    expect(marksMismatch([section(4, 5, 3)], '10')).toEqual({ allocated: 12, total: 10 })
  })
  it('stays quiet when they agree', () => {
    expect(marksMismatch([section(2)], '10')).toBeNull()
    expect(marksMismatch([section(1), section(1)], 10)).toBeNull()
  })
  it('stays quiet with no sections, only dividers, or no usable total', () => {
    expect(marksMismatch([], '100')).toBeNull()
    expect(marksMismatch(undefined, '100')).toBeNull()
    expect(marksMismatch([{ type: 'divider', title: 'B' }], '100')).toBeNull()
    expect(marksMismatch([section(1)], '')).toBeNull()
    expect(marksMismatch([section(1)], '0')).toBeNull()
  })
})
