import { describe, expect, it } from 'vitest'
import {
  bankAddedMessage,
  numberFromText,
  bankQuestionsToBlocks,
  isLostActivity,
  blockSummary,
  blockPictures,
  capturedPaperToBlocks,
  documentMarks,
  duplicateBlock,
  mergeSavedIds,
  moveBlock,
  newBlock,
  problemsByQuestion,
  questionNumbers,
  withItemKeys,
  matchingPairs, countingList, isDefaultTitle, newBlockFor, rowsWithPictures,
  applyStructure, blockHasContent, freshStructureRows, stillToFill, structureFromBlocks, structureTotal,
  isEarlyClass, pickerGroups,
} from '../blockDocument'

// A slice of what GET /api/examinations/paper-blocks/ returns.
const registry = {
  blocks: [
    { type: 'section_heading', kind: 'layout', fields: [] },
    {
      type: 'count_write', kind: 'activity', label: 'Count and write', fields: [
        { name: 'rows', kind: 'list', max: 12, fields: [
          { name: 'picture', kind: 'picture' },
          { name: 'count', kind: 'int', min: 1, max: 7, default: 3 },
        ] },
      ],
    },
    {
      type: 'mcq', kind: 'text', label: 'Multiple choice', fields: [
        { name: 'items', kind: 'list', fields: [
          { name: 'text', kind: 'richtext' },
          { name: 'options', kind: 'list', min: 2, max: 6, fields: [
            { name: 'text', kind: 'richtext', optional: true },
            { name: 'picture', kind: 'picture', optional: true },
          ] },
          { name: 'answer', kind: 'choice', choices: ['A', 'B', 'C', 'D'], optional: true },
        ] },
        { name: 'columns', kind: 'choice', choices: ['auto', '1', '2', '4'], default: 'auto', optional: true },
        { name: 'attempt', kind: 'int', min: 1, max: 60, optional: true },
      ],
    },
  ],
}

describe('newBlock', () => {
  it('builds a block from the field list with sensible starting data', () => {
    const block = newBlock('mcq', registry)
    expect(block.title).toBe('Choose the correct option.')
    expect(block.marks).toBe(5)
    expect(block.data.columns).toBe('auto')
    expect(block.data).not.toHaveProperty('attempt')
    expect(block.data.items).toHaveLength(1)
    expect(block.data.items[0].options).toHaveLength(4)
    expect(block.data.items[0].key).toBeTruthy()

    const count = newBlock('count_write', registry)
    expect(count.data.rows[0]).toMatchObject({ picture: '', count: 3 })
  })

  it('gives a heading no marks and no data', () => {
    expect(newBlock('section_heading', registry)).toEqual({ id: expect.any(String), type: 'section_heading', title: 'Section A' })
  })
})

describe('numbers and marks', () => {
  const blocks = [newBlock('section_heading', registry), { ...newBlock('mcq', registry), marks: 4 }, { ...newBlock('count_write', registry), marks: 6 }]
  it('skips headings when numbering and adding up', () => {
    expect(questionNumbers(blocks, registry)).toEqual([null, 1, 2])
    expect(documentMarks({ blocks: [...blocks, { type: 'section_heading', marks: 50 }] }, registry)).toBe(10)
  })
  it('summarises a block for the outline', () => {
    expect(blockSummary(blocks[1], registry)).toBe('Multiple choice · 1 part')
  })
})

describe('moving and copying', () => {
  it('moves within bounds only', () => {
    expect(moveBlock(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(moveBlock(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
  })
  it('a copy has new ids and no question links', () => {
    const block = { id: 'x', type: 'mcq', question_id: 9, data: { items: [{ key: 'k', question_id: 4, text: 'q' }] } }
    const copy = duplicateBlock(block)
    expect(copy.id).not.toBe('x')
    expect(copy).not.toHaveProperty('question_id')
    expect(copy.data.items[0]).toEqual({ key: expect.any(String), text: 'q' })
    expect(copy.data.items[0].key).not.toBe('k')
    expect(block.data.items[0].question_id).toBe(4)
  })
})

describe('mergeSavedIds', () => {
  it('copies question ids back by block id and part key, keeping later edits', () => {
    const local = { blocks: [
      { id: 'b1', type: 'count_write', title: 'Edited after save', data: { rows: [] } },
      { id: 'b2', type: 'mcq', data: { items: [{ key: 'k1', text: 'typed later' }, { key: 'k2', text: 'new part' }] } },
      { id: 'b3', type: 'mcq', data: { items: [] } },
    ] }
    const saved = { blocks: [
      { id: 'b1', type: 'count_write', title: 'Old', question_id: 11, data: { rows: [] } },
      { id: 'b2', type: 'mcq', data: { items: [{ key: 'k1', text: 'old', question_id: 21 }] } },
    ] }
    const merged = mergeSavedIds(local, saved)
    expect(merged.blocks[0]).toMatchObject({ title: 'Edited after save', question_id: 11 })
    expect(merged.blocks[1].data.items).toEqual([
      { key: 'k1', text: 'typed later', question_id: 21 },
      { key: 'k2', text: 'new part' },
    ])
    expect(merged.blocks[2]).toBe(local.blocks[2])
  })

  it('adds keys to parts that have none (old papers opened as blocks)', () => {
    const doc = withItemKeys({ blocks: [{ id: 'b', data: { items: [{ text: 'a' }, { text: 'b', key: 'kept' }] } }, { id: 'h' }] })
    expect(doc.blocks[0].data.items[0].key).toBeTruthy()
    expect(doc.blocks[0].data.items[1].key).toBe('kept')
    expect(doc.blocks[1]).toEqual({ id: 'h' })
  })
})

describe('bank questions to blocks', () => {
  it('groups consecutive questions of one type and keeps their bank ids', () => {
    const blocks = bankQuestionsToBlocks([
      { id: 1, question_type: 'MCQ', question_text: 'A?', option_a: 'x', option_b: 'y', correct_answer: 'B', marks: 1 },
      { id: 2, question_type: 'MCQ', question_text: 'B?', option_a: 'p', option_b: 'q', marks: 1 },
      { id: 3, question_type: 'FILL_BLANK', question_text: 'The ___ sets.', type_data: { accepted_answers: ['sun'] }, marks: 2 },
      { id: 4, question_type: 'MATCHING', question_text: '<p>Match</p>', type_data: { pairs: [{ left: 'a', right: 'b' }] }, marks: 3 },
      { id: 5, question_type: 'TRUE_FALSE', question_text: 'Yes?', correct_answer: 'true', marks: 1 },
    ])
    expect(blocks.map((b) => b.type)).toEqual(['mcq', 'fill_blank', 'matching', 'true_false'])
    expect(blocks[0].marks).toBe(2)
    expect(blocks[0].data.items.map((i) => i.question_id)).toEqual([1, 2])
    expect(blocks[0].data.items[0]).toMatchObject({ answer: 'B', options: [{ text: 'x' }, { text: 'y' }] })
    expect(blocks[1].data.items[0].answers).toEqual(['sun'])
    expect(blocks[2]).toMatchObject({ question_id: 4, title: 'Match', marks: 3, data: { items: [{ left: 'a', right: 'b' }] } })
    expect(blocks[3].data.items[0].answer).toBe('TRUE')
  })

  const savedBlock = {
    type: 'count_write', title: 'Count and write.', marks: 5,
    data: { rows: [{ picture: 'star', count: 3 }, { picture: 'apple', count: 2 }] },
  }

  it('restores an activity question as the block it was saved as', () => {
    const activity = { id: 7, question_type: 'ACTIVITY', question_text: 'Count and write.', marks: '6.00', type_data: { block: savedBlock } }
    const [block] = bankQuestionsToBlocks([activity])
    expect(block).toMatchObject({ type: 'count_write', title: 'Count and write.', marks: 6, question_id: 7, data: savedBlock.data })
    expect(block.id).toBeTruthy()
    // The bank row is never changed through the block (the server compares the data to reuse the question).
    block.data.rows[0].count = 9
    expect(savedBlock.data.rows[0].count).toBe(3)
  })

  it('leaves out an activity without its saved block and says so', () => {
    const lost = { id: 8, question_type: 'ACTIVITY', question_text: 'Old drawing', type_data: {} }
    const short = { id: 9, question_type: 'SHORT', question_text: 'Why?', marks: 2 }
    expect(isLostActivity(lost)).toBe(true)
    expect(isLostActivity(short)).toBe(false)
    expect(bankQuestionsToBlocks([lost, short]).map((b) => b.type)).toEqual(['short_answer'])
    expect(bankAddedMessage([lost, short])).toBe('1 question added from the bank. 1 activity could not be added because its drawing was not saved.')
    expect(bankAddedMessage([lost, lost])).toBe('2 activities could not be added because their drawings were not saved.')
    expect(bankAddedMessage([short])).toBe('1 question added from the bank.')
  })

  it('keeps the picked order in a mixed list, one block per activity', () => {
    const activity = (id) => ({ id, question_type: 'ACTIVITY', marks: 5, type_data: { block: savedBlock } })
    const blocks = bankQuestionsToBlocks([
      { id: 1, question_type: 'SHORT', question_text: 'A', marks: 1 },
      activity(2),
      activity(3),
      { id: 4, question_type: 'SHORT', question_text: 'B', marks: 1 },
      { id: 5, question_type: 'SHORT', question_text: 'C', marks: 1 },
    ])
    expect(blocks.map((b) => [b.type, b.question_id ?? b.data.items.map((i) => i.question_id)])).toEqual([
      ['short_answer', [1]], ['count_write', 2], ['count_write', 3], ['short_answer', [4, 5]],
    ])
  })
})

describe('captured paper to blocks', () => {
  it('turns the reviewed photo into blocks with section marks and attempt-any', () => {
    const blocks = capturedPaperToBlocks({
      structure: [
        { key: 's1', type: 'question_group', title: 'Q1', instruction: '', slots_shown: 3, slots_counted: 2, marks_per_question: 2 },
        { key: 'd', type: 'divider', title: 'Section B' },
        { key: 's2', type: 'question_group', title: 'Q2', instruction: 'Answer briefly.', slots_shown: 1, slots_counted: 1, marks_per_question: 5 },
      ],
      questions: [
        { section_key: 's1', question_type: 'SHORT', question_text: 'One', marks: 2, question_id: 99 },
        { section_key: 's1', question_type: 'SHORT', question_text: 'Two', marks: 2 },
        { section_key: 's1', question_type: 'SHORT', question_text: 'Three', marks: 2, question_image_url: 'https://x/a.png' },
        { section_key: 's2', question_type: 'LONG', question_text: 'Explain', marks: 5 },
        { section_key: '', question_type: 'MCQ', question_text: 'Loose', options: { A: 'a', B: 'b' }, marks: 1 },
      ],
    })
    expect(blocks.map((b) => b.type)).toEqual(['short_answer', 'section_heading', 'long_answer', 'mcq'])
    expect(blocks[0]).toMatchObject({ marks: 4, data: { attempt: 2, lines: 2 } })
    expect(blocks[0].data.items[0]).not.toHaveProperty('question_id')
    expect(blocks[0].data.items[2].picture).toEqual({ url: 'https://x/a.png' })
    expect(blocks[2]).toMatchObject({ title: 'Answer briefly.', marks: 5 })
    expect(blocks[3].data.items[0].options.map((o) => o.text)).toEqual(['a', 'b'])
  })
})

describe('photo scan blocks', () => {
  const scanned = [
    { id: 'a1', type: 'count_write', title: 'Count and write?', marks: 5, page_number: 1,
      data: { rows: [{ picture: 'apple', count: 3 }, { picture: { url: 'https://files/x.jpg' }, count: 2 }] } },
    { id: 'a2', type: 'mcq', title: 'Choose.', marks: 2, page_number: 2, question_id: 7,
      data: { items: [{ text: '$2+2$', options: [{ text: '3' }, { text: '4', picture: 'star' }] }] } },
  ]

  it('uses the scanned blocks as they are, with fresh ids and no review-only keys', () => {
    const blocks = capturedPaperToBlocks({ blocks: scanned, questions: [{ question_text: 'ignored' }] })
    expect(blocks.map((b) => b.type)).toEqual(['count_write', 'mcq'])
    expect(blocks[0].id).not.toBe('a1')
    expect(new Set(blocks.map((b) => b.id)).size).toBe(2)
    expect(blocks[0]).not.toHaveProperty('page_number')
    expect(blocks[1]).not.toHaveProperty('question_id')
    expect(blocks[1].data.items[0].key).toBeTruthy()
    expect(blocks[0].data.rows[1].picture).toEqual({ url: 'https://files/x.jpg' })
    blocks[0].data.rows[0].count = 9
    expect(scanned[0].data.rows[0].count).toBe(3)
  })

  it('lists every picture a block uses', () => {
    expect(blockPictures(scanned[0])).toEqual(['apple', { url: 'https://files/x.jpg' }])
    expect(blockPictures(scanned[1])).toEqual(['star'])
    expect(blockPictures({ type: 'writing_grid', data: { rows: 4 } })).toEqual([])
  })
})

describe('problemsByQuestion', () => {
  it('files server messages under their question number', () => {
    const map = problemsByQuestion(['Question 2: \'answer\' must be one of: A, B.', 'Heading: the title must be text.', 'Question 2: marks must be a number, zero or more.'])
    expect([...map.keys()]).toEqual([2])
    expect(map.get(2)).toHaveLength(2)
  })
})

describe('matchingPairs (old bank matching questions, Phase 7 step 7b)', () => {
  it('reads the question bank form: left/right items linked by index', () => {
    const typeData = { left_items: ['Fish', 'Bird', 'Cow'], right_items: ['Water', 'Nest', 'Barn'], pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }] }
    expect(matchingPairs(typeData)).toEqual([
      { left: 'Fish', right: 'Water' }, { left: 'Bird', right: 'Nest' }, { left: 'Cow', right: '' },
    ])
  })

  it('reads the block editor form: pairs of texts', () => {
    expect(matchingPairs({ pairs: [{ left: 'a', right: 'b' }] })).toEqual([{ left: 'a', right: 'b' }])
    expect(matchingPairs({})).toEqual([])
  })
})

describe('numberFromText', () => {
  it('waits while the box is empty or out of range, and gives the clamped value', () => {
    expect(numberFromText('', { min: 1, max: 7, fallback: 3 })).toEqual({ value: 3, complete: false })
    expect(numberFromText('5', { min: 1, max: 7 })).toEqual({ value: 5, complete: true })
    expect(numberFromText('12', { min: 1, max: 7 })).toEqual({ value: 7, complete: false })
    expect(numberFromText('0', { min: 1, max: 7 })).toEqual({ value: 1, complete: false })
    expect(numberFromText('2.6', { min: 1, integer: true })).toEqual({ value: 3, complete: true })
    expect(numberFromText('', { optional: true })).toEqual({ value: undefined, complete: true })
  })
})

describe('countingList (faster 1)', () => {
  it('counts 1 to N and leaves every k-th number empty', () => {
    expect(countingList(10, 2)).toEqual(['1', '', '3', '', '5', '', '7', '', '9', ''])
    expect(countingList('4', '0')).toEqual(['1', '2', '3', '4'])
    expect(countingList(5, 1)).toEqual(['1', '2', '3', '4', '5'])
  })

  it('keeps to the list size and ignores nonsense', () => {
    expect(countingList(100, 2, 20)).toHaveLength(20)
    expect(countingList('x', 2)).toEqual([])
    expect(countingList(-3, 2)).toEqual([])
  })
})

describe('rowsWithPictures (faster 4)', () => {
  const rowsField = { name: 'rows', kind: 'list', max: 3, fields: [
    { name: 'picture', kind: 'picture' }, { name: 'count', kind: 'int', min: 1, max: 7, default: 3 },
  ] }
  it('replaces blank rows, keeps filled ones and stops at the list size', () => {
    const { rows, dropped } = rowsWithPictures(rowsField, [{ key: 'a', picture: 'cat', count: 2 }, { key: 'b', picture: '', count: 3 }],
      [{ picture: 'dog', count: 0 }, { picture: 'hen' }, { picture: 'cow' }])
    expect(rows.map((r) => [r.picture, r.count])).toEqual([['cat', 2], ['dog', 1], ['hen', 3]])
    expect(dropped).toBe(1)
  })
  it('keeps a match part that has text', () => {
    const side = { name: 'left', kind: 'list', fields: [{ name: 'text', kind: 'text', optional: true }, { name: 'picture', kind: 'picture', optional: true }] }
    const { rows } = rowsWithPictures(side, [{ key: 'a', text: 'Cat' }, { key: 'b' }], [{ picture: 'apple', count: 2 }])
    expect(rows.map((r) => [r.text, r.picture, r.count])).toEqual([['Cat', undefined, undefined], [undefined, 'apple', undefined]])
  })
})

describe('new question defaults (faster 6)', () => {
  const reg = { blocks: [{ type: 'count_write', kind: 'activity', fields: [] }, { type: 'oral', kind: 'activity', fields: [] }] }
  it('takes the marks of the last question of the same type on a paper', () => {
    const blocks = [{ type: 'count_write', marks: 4 }, { type: 'oral', marks: 10 }, { type: 'count_write', marks: 6 }]
    expect(newBlockFor('paper', 'count_write', reg, blocks).marks).toBe(6)
    expect(newBlockFor('paper', 'oral', reg, [{ type: 'count_write', marks: 4 }]).marks).toBe(5)
    expect(newBlockFor('worksheet', 'count_write', reg, blocks).marks).toBeUndefined()
  })
  it('knows a heading is still the generic one', () => {
    const block = newBlockFor('paper', 'count_write', reg)
    expect(isDefaultTitle(block)).toBe(block.title !== '')
    expect(isDefaultTitle({ ...block, title: 'Count the apples.' })).toBe(false)
  })
})

describe('Structure step', () => {
  const reg = { blocks: [
    { type: 'count_write', kind: 'activity', fields: [{ name: 'rows', kind: 'list', max: 12, fields: [
      { name: 'picture', kind: 'picture' }, { name: 'count', kind: 'int', min: 1, max: 7, default: 3 }] }] },
    { type: 'compare_objects', kind: 'activity', fields: [{ name: 'mode', kind: 'choice', choices: ['size', 'length'], default: 'size' }] },
    { type: 'short_answer', kind: 'text', fields: [{ name: 'items', kind: 'list', fields: [{ name: 'text', kind: 'richtext' }] }] },
    { type: 'section_heading', kind: 'layout', fields: [] },
  ] }

  it('makes the questions from rows with empty parts, marks and settings', () => {
    const { blocks } = applyStructure([], [
      { type: 'count_write', marks: 5, parts: 4 },
      { type: 'compare_objects', marks: 4, data: { mode: 'length' } },
      { type: 'short_answer', marks: 6, parts: 3 },
    ], reg)
    expect(blocks.map((b) => [b.type, b.marks])).toEqual([['count_write', 5], ['compare_objects', 4], ['short_answer', 6]])
    expect(blocks[0].data.rows).toHaveLength(4)
    expect(blocks[1].data.mode).toBe('length')
    expect(blocks[1].title).toBe('Circle the long object.')
    expect(isDefaultTitle(blocks[1])).toBe(true)
    expect(blocks[2].data.items).toHaveLength(3)
    expect(blocks.every((b) => !blockHasContent(b, reg))).toBe(true)
    expect(stillToFill(blocks[0], reg)).toBe(true)
    expect(stillToFill(blocks[1], reg)).toBe(false)
  })

  it('reads a paper back as rows and changes it without losing what was typed', () => {
    const paper = [
      { id: 'h', type: 'section_heading', title: 'Section A' },
      { id: 'c', type: 'count_write', marks: 5, data: { rows: [{ picture: 'cat', count: 2 }, { picture: '', count: 3 }] } },
      { id: 's', type: 'short_answer', marks: 4, data: { items: [{ text: '<p>Why?</p>' }] } },
    ]
    const rows = structureFromBlocks(paper, reg)
    expect(rows.map((r) => [r.blockId, r.type, r.marks, r.parts])).toEqual([['c', 'count_write', 5, 2], ['s', 'short_answer', 4, 1]])
    expect(structureTotal(rows)).toBe(9)

    // fewer rows in Count and write keeps the filled one, the Short answer goes, a new row is added
    const next = [{ ...rows[0], parts: 0, marks: 6 }, { type: 'compare_objects', marks: 4 }]
    const { blocks, removed } = applyStructure(paper, next, reg)
    expect(blocks.map((b) => b.id ?? b.type).slice(0, 2)).toEqual(['h', 'c'])
    expect(blocks[1].marks).toBe(6)
    expect(blocks[1].data.rows).toEqual([{ picture: 'cat', count: 2 }])
    expect(blocks[2].type).toBe('compare_objects')
    expect(removed.map((b) => b.id)).toEqual(['s'])
    expect(blockHasContent(removed[0], reg)).toBe(true)
  })

  it('copies rows from a template or another paper as new rows', () => {
    const fresh = freshStructureRows([{ blockId: 'x', type: 'count_write', marks: 5, parts: 3 }])
    expect(fresh[0].blockId).toBeUndefined()
    expect(fresh[0].key).toBeTruthy()
  })
})

describe('picking a question type', () => {
  const reg = {
    type_groups: [
      { id: 'numbers', label: 'Numbers and counting', early: true },
      { id: 'objective', label: 'Quick answers', early: false },
      { id: 'oral', label: 'Oral', early: true },
      { id: 'layout', label: 'Layout', early: false },
    ],
    blocks: [
      { type: 'count_write', label: 'Count and write', kind: 'activity', group: 'numbers', hint: 'Pictures to count.' },
      { type: 'mcq', label: 'Multiple choice', kind: 'text', group: 'objective', hint: 'Choose the correct option.' },
      { type: 'matching', label: 'Match column A with column B', kind: 'text', group: 'objective', hint: '' },
      { type: 'oral', label: 'Oral', kind: 'activity', group: 'oral', hint: '' },
      { type: 'section_heading', label: 'Section heading', kind: 'layout', group: 'layout', hint: '' },
    ],
  }
  it('knows the early classes', () => {
    expect(['Play Group', 'play-group A', 'Nursery', 'Prep', 'PREP B'].every(isEarlyClass)).toBe(true)
    expect(['Class 1', 'Grade 2', 'Preparatory? no: Class 3', ''].some(isEarlyClass)).toBe(false)
  })
  it('orders groups for the class, puts used types first and layout last', () => {
    expect(pickerGroups(reg, { early: true }).map((g) => g.id)).toEqual(['numbers', 'oral', 'objective', 'layout'])
    expect(pickerGroups(reg, { early: false, used: ['mcq', 'mcq'] }).map((g) => g.id)).toEqual(['used', 'objective', 'numbers', 'oral', 'layout'])
    expect(pickerGroups(reg, { used: ['mcq'] })[0].types.map((t) => t.type)).toEqual(['mcq'])
    expect(pickerGroups(reg, { layout: false }).some((g) => g.id === 'layout')).toBe(false)
  })
  it('searches names and hints', () => {
    const found = pickerGroups(reg, { search: 'match', used: ['mcq'] })
    expect(found.map((g) => [g.id, g.types.map((t) => t.type)])).toEqual([['objective', ['matching']]])
    expect(pickerGroups(reg, { search: 'count' })[0].types[0].type).toBe('count_write')
  })
})
