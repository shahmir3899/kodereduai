import { describe, expect, it } from 'vitest'
import { documentApi, headerSwitchOn } from '../documentApi'
import { newBlockFor, withMarks } from '../blockDocument'
import { questionPaperApi, worksheetApi } from '../../../../services/api'

const registry = {
  blocks: [
    { type: 'short_answer', kind: 'text', label: 'Short answer', fields: [] },
    { type: 'section_heading', kind: 'layout', label: 'Section heading', fields: [] },
  ],
}

describe('documentApi (papers and worksheets share the block editor)', () => {
  it('sends each kind to its own endpoints', () => {
    expect(documentApi('paper').getDocument).toBe(questionPaperApi.getPaperDocument)
    expect(documentApi('worksheet').getDocument).toBe(worksheetApi.getDocument)
    expect(documentApi('worksheet').saveDocument).toBe(worksheetApi.saveDocument)
    expect(documentApi('worksheet').getPrintHtml).toBe(worksheetApi.getPrintHtml)
    expect(documentApi('worksheet').generateDOCX).toBe(worksheetApi.generateDOCX)
    expect(documentApi('paper').getAnswerKeyHtml).toBe(questionPaperApi.getAnswerKeyHtml)
    expect(documentApi('worksheet').getAnswerKeyHtml).toBe(worksheetApi.getAnswerKeyHtml)
    expect(documentApi('worksheet').noun).toBe('worksheet')
    expect(documentApi().noun).toBe('paper')
    expect(documentApi('nonsense').noun).toBe('paper')
  })

  it('header switches are on by default for a paper and off for a worksheet', () => {
    expect(headerSwitchOn({}, 'marks_table', 'paper')).toBe(true)
    expect(headerSwitchOn({ marks_table: false }, 'marks_table', 'paper')).toBe(false)
    expect(headerSwitchOn({}, 'show_time_marks', 'worksheet')).toBe(false)
    expect(headerSwitchOn({ show_time_marks: true }, 'show_time_marks', 'worksheet')).toBe(true)
  })
})

describe('worksheet marks are optional', () => {
  it('a new worksheet block has no marks; a paper block has 5', () => {
    expect(newBlockFor('worksheet', 'short_answer', registry)).not.toHaveProperty('marks')
    expect(newBlockFor('paper', 'short_answer', registry).marks).toBe(5)
    expect(newBlockFor('worksheet', 'section_heading', registry)).not.toHaveProperty('marks')
  })

  it('an empty marks box means none on a worksheet and 0 on a paper', () => {
    const block = { id: 'a', type: 'short_answer', marks: 3 }
    expect(withMarks(block, '', true)).not.toHaveProperty('marks')
    expect(withMarks(block, '', false).marks).toBe(0)
    expect(withMarks(block, '2.5', true).marks).toBe(2.5)
    expect(block.marks).toBe(3)
  })
})
