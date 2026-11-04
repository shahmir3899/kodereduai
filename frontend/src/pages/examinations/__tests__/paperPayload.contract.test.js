import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildManualAutosaveQuestions, buildPaperEnsurePayload } from '../paperPayload'

// The same file is read by the mobile app's tests (mobile/__tests__/paperContract.test.ts): web is the
// reference, so these expected payloads may only change on purpose, with the mobile side updated too.
const { fixtures } = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../docs/paper-contract/fixtures.json'), 'utf8'))

describe('paper payload contract (web is the reference)', () => {
  it.each(fixtures.map((f) => [f.name, f]))('%s', (_name, f) => {
    const draft = {
      paper_title: f.setup.paper_title,
      instructions: f.setup.instructions,
      total_marks: f.setup.total_marks,
      duration_minutes: f.setup.duration_minutes,
    }
    const ensure = buildPaperEnsurePayload({
      classObj: f.setup.class_obj, subject: f.setup.subject, exam: f.setup.exam,
      manualDraft: draft, structure: f.structure, renderOptions: f.setup.render_options,
    })
    expect(ensure).toEqual(f.expected.ensure)
    expect(buildManualAutosaveQuestions(f.questions, f.structure)).toEqual(f.expected.manual_questions)
  })

  it('puts questions in section order, unassigned last', () => {
    const f = fixtures.find((x) => x.name === 'fill-and-mcq')
    const shuffled = [...f.questions].reverse()
    const out = buildManualAutosaveQuestions(shuffled, f.structure)
    expect(out.map((q) => q.section_key)).toEqual(['s1', 's1', 's1', 's1', 's1', 's2', 's2', 's2', 's2', 's2'])
    expect(out.map((q) => q.question_order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})
