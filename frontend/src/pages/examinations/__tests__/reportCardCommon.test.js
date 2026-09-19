import { describe, it, expect } from 'vitest'
import { ordinal, positionText, gradeKeyText, rowsWithComments } from '../reportCardTemplates/common'

describe('report card helpers', () => {
  it('builds ordinals, including the 11th-13th exceptions', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 112].map(ordinal))
      .toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '112th'])
    expect(positionText(4, 33)).toBe('4th of 33')
    expect(positionText(4, null)).toBe('4th')
  })

  it('lists grade bands highest first on one line, empty without a scale', () => {
    const text = gradeKeyText([
      { grade_label: 'B', min_percentage: 70, max_percentage: 79.99 },
      { grade_label: 'A+', min_percentage: 90, max_percentage: 100 },
    ])
    expect(text.indexOf('A+')).toBeLessThan(text.indexOf('B '))
    expect(text).not.toContain('\n')
    expect(gradeKeyText([])).toBe('')
  })

  it('adds a full-width comment row directly under only the commented subjects', () => {
    const { body, meta } = rowsWithComments(
      [{ n: 'Maths', comment: 'Good' }, { n: 'Urdu' }, { n: 'GK', comment: 'Fine' }],
      s => [s.n, 1], 2,
    )
    expect(body).toHaveLength(5)
    expect(body[1][0]).toMatchObject({ content: 'Good', colSpan: 2 })
    expect(meta.map(m => [m.subjectIdx, m.isComment])).toEqual([[0, false], [0, true], [1, false], [2, false], [2, true]])
  })
})
