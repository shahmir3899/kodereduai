import { useCallback } from 'react'

const QUESTION_TYPES = [
  { value: 'MCQ', label: 'Multiple Choice' },
  { value: 'SHORT', label: 'Short Answer' },
  { value: 'LONG', label: 'Long Answer' },
  { value: 'ESSAY', label: 'Essay' },
  { value: 'TRUE_FALSE', label: 'True/False' },
  { value: 'MATCHING', label: 'Matching' },
  { value: 'FILL_BLANK', label: 'Fill in the Blanks' },
]

function makeSectionId() {
  return `sec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function autoInstruction(counted) {
  return `Attempt any ${counted} questions.`
}

export function makeDefaultSection(index, overrides = {}) {
  const slotsShown = overrides.slots_shown ?? 5
  const slotsCounted = overrides.slots_counted ?? slotsShown
  const isChoice = overrides.is_choice ?? slotsCounted !== slotsShown
  return {
    local_id: makeSectionId(),
    key: overrides.key || makeSectionId(),
    type: 'question_group',
    title: overrides.title ?? `Q${index + 1}`,
    instruction: overrides.instruction ?? (isChoice ? autoInstruction(slotsCounted) : ''),
    instructionIsAuto: overrides.instructionIsAuto ?? isChoice,
    question_type: overrides.question_type || 'SHORT',
    slots_shown: slotsShown,
    slots_counted: slotsCounted,
    marks_per_question: overrides.marks_per_question ?? 1,
    is_choice: isChoice,
  }
}

/** A plain print-layout separator (e.g. "Section A") — no marks/slots/questions attach to it. */
export function makeDividerRow(overrides = {}) {
  return {
    local_id: makeSectionId(),
    key: overrides.key || makeSectionId(),
    type: 'divider',
    title: overrides.title ?? 'Section',
  }
}

/** Builds a starter section list scaled to the paper's total marks. */
export function buildAutoDistribution(totalMarksInput) {
  const total = Number(totalMarksInput) > 0 ? Number(totalMarksInput) : 100

  const mcq = makeDefaultSection(0, {
    title: 'Q1', question_type: 'MCQ', slots_shown: 10, marks_per_question: 1,
  })
  const short = makeDefaultSection(1, {
    title: 'Q2', question_type: 'SHORT', slots_shown: 5, marks_per_question: 4,
  })

  const fixedMarks = (mcq.slots_counted * mcq.marks_per_question)
    + (short.slots_counted * short.marks_per_question)
  const remaining = Math.max(total - fixedMarks, 8)
  const longMarksPerQuestion = 8
  const longCount = Math.max(1, Math.round(remaining / longMarksPerQuestion))
  const longMarksAdjusted = longCount > 0 ? Number((remaining / longCount).toFixed(2)) : longMarksPerQuestion

  const long = makeDefaultSection(2, {
    title: 'Q3', question_type: 'LONG', slots_shown: longCount, marks_per_question: longMarksAdjusted,
  })

  return [mcq, short, long]
}

/** Sums slots_counted * marks_per_question across question-group sections (dividers contribute 0). */
export function calculateAllocatedMarks(sections) {
  return (sections || []).reduce((sum, section) => {
    if (section.type === 'divider') return sum
    const counted = Number(section.slots_counted ?? section.slots_shown ?? 0) || 0
    const marks = Number(section.marks_per_question ?? 0) || 0
    return sum + counted * marks
  }, 0)
}

export default function PaperStructureBuilder({
  sections = [],
  onChange,
  totalMarks,
  readOnly = false,
}) {
  const updateSection = useCallback((localId, updates) => {
    if (readOnly) return
    onChange(sections.map((section) => (section.local_id === localId ? { ...section, ...updates } : section)))
  }, [onChange, readOnly, sections])

  const handleSlotsShownChange = (section, value) => {
    const slotsShown = Math.max(0, parseInt(value, 10) || 0)
    const updates = { slots_shown: slotsShown }
    if (!section.is_choice) {
      updates.slots_counted = slotsShown
    }
    updateSection(section.local_id, updates)
  }

  const handleSlotsCountedChange = (section, value) => {
    const slotsCounted = Math.max(0, parseInt(value, 10) || 0)
    const updates = { slots_counted: slotsCounted }
    if (section.instructionIsAuto) {
      updates.instruction = autoInstruction(slotsCounted)
    }
    updateSection(section.local_id, updates)
  }

  const handleChoiceToggle = (section, checked) => {
    if (checked) {
      const slotsCounted = Math.max(1, Math.min(section.slots_shown, section.slots_shown - 1))
      updateSection(section.local_id, {
        is_choice: true,
        slots_counted: slotsCounted,
        instruction: section.instructionIsAuto !== false ? autoInstruction(slotsCounted) : section.instruction,
        instructionIsAuto: section.instructionIsAuto !== false,
      })
    } else {
      updateSection(section.local_id, {
        is_choice: false,
        slots_counted: section.slots_shown,
        instruction: '',
        instructionIsAuto: false,
      })
    }
  }

  const handleInstructionChange = (section, value) => {
    updateSection(section.local_id, { instruction: value, instructionIsAuto: false })
  }

  const handleAddRow = () => {
    if (readOnly) return
    onChange([...sections, makeDefaultSection(sections.length)])
  }

  const handleAddDivider = () => {
    if (readOnly) return
    onChange([...sections, makeDividerRow()])
  }

  const handleRemoveRow = (localId) => {
    if (readOnly) return
    onChange(sections.filter((section) => section.local_id !== localId))
  }

  const handleMoveRow = (index, direction) => {
    if (readOnly) return
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= sections.length) return
    const next = [...sections]
    const [moved] = next.splice(index, 1)
    next.splice(targetIndex, 0, moved)
    onChange(next)
  }

  const handleDistribute = () => {
    if (readOnly) return
    onChange(buildAutoDistribution(totalMarks))
  }

  const allocated = calculateAllocatedMarks(sections)
  const total = Number(totalMarks) || 0
  const isMismatched = total > 0 && allocated !== total

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className={`text-sm font-medium px-3 py-2 rounded-lg border ${
            isMismatched
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          Allocated: {allocated} / {total || '?'} marks
          {isMismatched && ' — marks do not match total yet'}
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={handleDistribute}
            className="px-3 py-2 border border-blue-300 text-blue-700 rounded-lg text-sm hover:bg-blue-50"
          >
            Distribute automatically
          </button>
        )}
      </div>

      {sections.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
          No questions yet. Add a question group below, or use "Distribute automatically".
        </div>
      ) : (
        <div className="space-y-3">
          {sections.map((section, index) => (
            section.type === 'divider' ? (
              <div key={section.local_id} className="border-2 border-dashed border-gray-300 rounded-lg p-3 bg-gray-50 flex items-center gap-3">
                <span className="text-xs font-semibold text-gray-500 uppercase shrink-0">Section</span>
                <input
                  type="text"
                  value={section.title}
                  disabled={readOnly}
                  onChange={(e) => updateSection(section.local_id, { title: e.target.value })}
                  placeholder="e.g. Section A: Objective"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {!readOnly && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleMoveRow(index, -1)}
                      disabled={index === 0}
                      className="px-2 py-1 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveRow(index, 1)}
                      disabled={index === sections.length - 1}
                      className="px-2 py-1 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(section.local_id)}
                      className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            ) : (
            <div key={section.local_id} className="border border-gray-200 rounded-lg p-4 bg-white">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
                  <input
                    type="text"
                    value={section.title}
                    disabled={readOnly}
                    onChange={(e) => updateSection(section.local_id, { title: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Question Type</label>
                  <select
                    value={section.question_type}
                    disabled={readOnly}
                    onChange={(e) => updateSection(section.local_id, { question_type: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {QUESTION_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1"># of Questions</label>
                  <input
                    type="number"
                    min="0"
                    value={section.slots_shown}
                    disabled={readOnly}
                    onChange={(e) => handleSlotsShownChange(section, e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Marks / Question</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={section.marks_per_question}
                    disabled={readOnly}
                    onChange={(e) => updateSection(section.local_id, { marks_per_question: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  id={`choice-${section.local_id}`}
                  checked={section.is_choice}
                  disabled={readOnly}
                  onChange={(e) => handleChoiceToggle(section, e.target.checked)}
                />
                <label htmlFor={`choice-${section.local_id}`} className="text-sm text-gray-700">
                  Choice section (Attempt any N of M)
                </label>
              </div>

              {section.is_choice && (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 bg-gray-50 rounded-lg p-3 border border-gray-100">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Attempt any N of {section.slots_shown}
                    </label>
                    <input
                      type="number"
                      min="1"
                      max={section.slots_shown}
                      value={section.slots_counted}
                      disabled={readOnly}
                      onChange={(e) => handleSlotsCountedChange(section, e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Instruction</label>
                    <input
                      type="text"
                      value={section.instruction}
                      disabled={readOnly}
                      onChange={(e) => handleInstructionChange(section, e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              )}

              {!readOnly && (
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => handleMoveRow(index, -1)}
                    disabled={index === 0}
                    className="px-2 py-1 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    ↑ Move up
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveRow(index, 1)}
                    disabled={index === sections.length - 1}
                    className="px-2 py-1 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    ↓ Move down
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveRow(section.local_id)}
                    className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
            )
          ))}
        </div>
      )}

      {!readOnly && (
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            onClick={handleAddRow}
            className="flex-1 px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
          >
            + Add Questions
          </button>
          <button
            type="button"
            onClick={handleAddDivider}
            className="flex-1 px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
          >
            + Add Section (separator)
          </button>
        </div>
      )}
    </div>
  )
}
