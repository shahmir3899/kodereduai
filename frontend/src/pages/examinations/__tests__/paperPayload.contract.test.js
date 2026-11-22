import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildPaperEnsurePayload } from '../paperPayload'

// The same file is read by the mobile app's tests (mobile/__tests__/paperContract.test.ts): web is the
// reference, so these expected payloads may only change on purpose, with the mobile side updated too.
// Only the paper details (ensure-draft) are pinned since Phase 7: the questions are the block list.
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
  })

})
