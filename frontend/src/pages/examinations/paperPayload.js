import { calculateAllocatedMarks } from './PaperStructureBuilder'

// Pure builders for the Question Paper Builder's server payloads. Kept out of the page so the same
// fixtures (docs/paper-contract/) can pin what web sends, and the mobile app can be tested against it.

export function hydrateStructure(structure) {
  if (!Array.isArray(structure)) return []
  return structure.map((section, index) => {
    const localId = `sec_${section?.key || index}_${index}`
    const key = section?.key || `sec_${Date.now()}_${index}`

    if (section?.type === 'divider') {
      return { local_id: localId, key, type: 'divider', title: section?.title || 'Section' }
    }

    const slotsShown = Number(section?.slots_shown ?? 0) || 0
    const slotsCounted = Number(section?.slots_counted ?? slotsShown) || 0
    const isChoice = slotsCounted !== slotsShown
    return {
      local_id: localId,
      key,
      type: 'question_group',
      title: section?.title || `Q${index + 1}`,
      instruction: section?.instruction || '',
      instructionIsAuto: false,
      question_type: section?.question_type || 'SHORT',
      slots_shown: slotsShown,
      slots_counted: slotsCounted,
      marks_per_question: Number(section?.marks_per_question ?? 0) || 0,
      is_choice: isChoice,
    }
  })
}

export function serializeStructure(sections) {
  return (sections || []).map((section) => {
    if (section.type === 'divider') {
      return { key: section.key, type: 'divider', title: section.title }
    }
    return {
      key: section.key,
      type: 'question_group',
      title: section.title,
      instruction: section.instruction,
      question_type: section.question_type,
      slots_shown: section.slots_shown,
      slots_counted: section.slots_counted,
      marks_per_question: section.marks_per_question,
    }
  })
}

/**
 * Flattens draft questions into autosave order: sections in structure order first
 * (preserving each question's relative position within its section), then any
 * questions not linked to a section key.
 */
export function orderQuestionsForAutosave(questions, structure) {
  const orderedKeys = (structure || [])
    .filter((section) => section.type !== 'divider')
    .map((section) => section.key)
    .filter(Boolean)
  const bySection = new Map()
  const unassigned = []

  ;(questions || []).forEach((question) => {
    const sectionKey = question.section_key || ''
    if (sectionKey && orderedKeys.includes(sectionKey)) {
      if (!bySection.has(sectionKey)) bySection.set(sectionKey, [])
      bySection.get(sectionKey).push(question)
    } else {
      unassigned.push(question)
    }
  })

  const ordered = []
  orderedKeys.forEach((key) => {
    ordered.push(...(bySection.get(key) || []))
  })
  ordered.push(...unassigned)
  return ordered
}

export function buildManualAutosaveQuestions(questions, structure = []) {
  return orderQuestionsForAutosave(questions, structure).map((question, index) => ({
    question_id: question.question_id || undefined,
    question_order: index + 1,
    section_key: question.section_key || '',
    marks_override: Number(question.marks_override ?? question.marks ?? 1) || 1,
    question_text: question.question_text || '',
    question_type: question.question_type || 'SHORT',
    difficulty_level: question.difficulty_level || 'MEDIUM',
    bloom_level: question.bloom_level || undefined,
    marks: Number(question.marks ?? 1) || 1,
    option_a: question.options?.A || '',
    option_b: question.options?.B || '',
    option_c: question.options?.C || '',
    option_d: question.options?.D || '',
    correct_answer: question.correct_answer || '',
    answer_text: question.answer_text || '',
    type_data: question.type_data || {},
    tested_topics: Array.isArray(question.tested_topics) ? question.tested_topics : [],
    local_id: question.local_id,
  }))
}


export function buildPaperEnsurePayload({ classObj, subject, exam, manualDraft, structure, renderOptions }) {
  const payload = {
    class_obj: classObj || undefined,
    subject: subject || undefined,
    exam: exam || undefined,
    paper_title: (manualDraft.paper_title || '').trim() || undefined,
    instructions: manualDraft.instructions || '',
    structure: serializeStructure(structure),
    render_options: renderOptions,
  }

  const parsedTotal = Number(manualDraft.total_marks)
  if (!Number.isNaN(parsedTotal) && parsedTotal > 0) {
    payload.total_marks = parsedTotal
  }

  const parsedDuration = parseInt(manualDraft.duration_minutes, 10)
  if (!Number.isNaN(parsedDuration) && parsedDuration > 0) {
    payload.duration_minutes = parsedDuration
  }

  return payload
}

// Step 2 -> 3 check: do the sections add up to the typed Total Marks? Advisory only. With no sections there is nothing to
// compare, so no warning (the page used to warn "Allocated marks (0)..." on every free-form paper).
export function marksMismatch(structure, totalMarks) {
  const sections = (structure || []).filter((section) => section.type !== 'divider')
  const total = Number(totalMarks) || 0
  if (sections.length === 0 || total <= 0) return null
  const allocated = calculateAllocatedMarks(structure)
  return allocated !== total ? { allocated, total } : null
}
