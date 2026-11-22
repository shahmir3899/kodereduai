// Pure builders for the Question Paper Builder's paper-details payload (ensure-draft). The questions are the
// block list, saved by the block editor. The old paper's `structure` is passed through unchanged, so an old
// paper that is never saved in the editor keeps it.

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
