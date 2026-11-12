// Pure helpers for the "capture from image" flow: turning the server's reconciled paper
// (GET paper-uploads/group-status/ -> result) into the structure rows and slotted draft
// questions the slot board uses, and keeping sections consistent when the user corrects
// a question's type. No React here so it is cheap to test.
import { makeDefaultSection } from './PaperStructureBuilder'

export const MAX_PAGES = 30
export const UPLOAD_CONCURRENCY = 3

const TYPE_LABELS = {
  MCQ: 'Multiple Choice',
  SHORT: 'Short Answer',
  LONG: 'Long Answer',
  ESSAY: 'Essay',
  TRUE_FALSE: 'True/False',
  MATCHING: 'Matching',
  FILL_BLANK: 'Fill in the Blanks',
}

let counter = 0
const uid = (prefix) => `${prefix}_${Date.now()}_${(counter += 1)}_${Math.random().toString(36).slice(2, 6)}`

export function parseDurationMinutes(label) {
  if (!label) return null
  const text = String(label).toLowerCase()
  const match = text.match(/(\d+(\.\d+)?)/)
  if (!match) return null
  const value = parseFloat(match[1])
  if (Number.isNaN(value)) return null
  return Math.round(text.includes('hour') ? value * 60 : value)
}

/** Question text may be HTML; the review list shows a one-line plain version. */
export function snippet(text, max = 110) {
  const plain = String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain
}

function toDraftQuestion(question, sectionKey) {
  const options = question?.options
  return {
    local_id: uid('ocr_q'),
    question_id: null,
    section_key: sectionKey,
    question_text: question?.question_text || '',
    question_type: question?.question_type || 'SHORT',
    difficulty_level: 'MEDIUM',
    bloom_level: '',
    marks: Number(question?.marks) || 1,
    marks_override: Number(question?.marks) || 1,
    correct_answer: '',
    answer_text: '',
    type_data: question?.type_data && typeof question.type_data === 'object' ? question.type_data : {},
    options: { A: options?.A || '', B: options?.B || '', C: options?.C || '', D: options?.D || '' },
    // Kept only for the review list; the slot board ignores unknown fields.
    needs_review: Boolean(question?.needs_review),
    // Where this question was read from, for the photo beside the review list.
    page_number: question?.page_number ?? null,
    box: question?.box ?? null,
    uncertain: Array.isArray(question?.uncertain) ? question.uncertain : [],
    // A drawing cropped from the page photo (same field the slot editor's diagram upload fills).
    question_image_url: question?.question_image_url || null,
  }
}

/** The server's reconciled paper -> { header, structure, questions, paperFields }. */
export function buildReview(result) {
  const header = result?.header || {}
  const structure = []
  const questions = []
  ;(result?.sections || []).forEach((section, index) => {
    const row = makeDefaultSection(index, {
      key: uid('sec'),
      title: section?.title || `Q${index + 1}`,
      instruction: section?.instruction || '',
      question_type: section?.question_type_guess || 'SHORT',
      slots_shown: Number(section?.shown_count) || 0,
      slots_counted: Number(section?.counted_count ?? section?.shown_count) || 0,
      marks_per_question: Number(section?.marks_per_question) || 0,
    })
    structure.push(row)
    ;(section?.questions || []).forEach((question) => questions.push(toDraftQuestion(question, row.key)))
  })
  return {
    header,
    structure,
    questions,
    paperFields: {
      paper_title: header.exam_title || '',
      total_marks: header.detected_total_marks != null ? String(header.detected_total_marks) : '',
      duration_minutes: String(parseDurationMinutes(header.duration_label) ?? 60),
    },
  }
}

/**
 * The user corrected one question's type. A section holds one type, so when the section
 * was uniform it is split into runs of the same type (same rule as the server's
 * paper_reconcile). An "attempt any N" section is left whole: the choice spans all of it.
 */
export function changeQuestionType(structure, questions, localId, newType) {
  const target = questions.find((q) => q.local_id === localId)
  if (!target || target.question_type === newType) return { structure, questions }

  const updated = questions.map((q) => (q.local_id === localId ? { ...q, question_type: newType, needs_review: false } : q))
  const row = structure.find((s) => s.key === target.section_key)
  if (!row || (row.slots_counted ?? 0) < (row.slots_shown ?? 0)) return { structure, questions: updated }

  const inSection = updated.filter((q) => q.section_key === row.key)
  const runs = []
  inSection.forEach((q) => {
    if (runs.length && runs[runs.length - 1][0].question_type === q.question_type) runs[runs.length - 1].push(q)
    else runs.push([q])
  })

  const sectionKeyOf = new Map()
  const newRows = runs.map((run, index) => {
    const type = run[0].question_type
    const marks = new Set(run.map((q) => q.marks))
    const key = index === 0 ? row.key : uid('sec')
    run.forEach((q) => sectionKeyOf.set(q.local_id, key))
    return index === 0 && runs.length === 1
      ? { ...row, question_type: type, slots_shown: run.length, slots_counted: run.length }
      : {
        ...row,
        key,
        local_id: index === 0 ? row.local_id : key,
        title: index === 0 ? row.title : `${row.title} (${TYPE_LABELS[type] || type})`,
        instruction: index === 0 ? row.instruction : '',
        question_type: type,
        slots_shown: run.length,
        slots_counted: run.length,
        marks_per_question: marks.size === 1 ? run[0].marks : row.marks_per_question,
      }
  })

  const nextStructure = structure.flatMap((s) => (s.key === row.key ? newRows : [s]))
  const nextQuestions = updated.map((q) => (sectionKeyOf.has(q.local_id) ? { ...q, section_key: sectionKeyOf.get(q.local_id) } : q))
  return { structure: nextStructure, questions: nextQuestions }
}

/** What the user must fill in on the review before accepting. Class and subject are not
 * asked here: the builder asks for them (with the detected labels as hints) and nothing
 * is saved until both are chosen. */
export function missingBeforeSave({ paperFields }) {
  const missing = []
  if (!String(paperFields?.paper_title || '').trim()) missing.push('Paper title')
  if (!(Number(paperFields?.total_marks) > 0)) missing.push('Total marks')
  return missing
}

/** Per-slot display state, merging what this browser knows with what the server reports. */
export function pageDisplayStatus(local, server) {
  if (local?.state === 'queued' || local?.state === 'uploading') return local.state
  if (!server || server.status === 'MISSING') return local?.state === 'failed' ? 'failed' : 'empty'
  if (server.status === 'EXTRACTED') return 'extracted'
  if (server.status === 'FAILED') return 'failed'
  return 'processing'
}

/** Client-made id that ties the pages of one capture together (the server accepts any uuid). */
export function newGroupId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}
