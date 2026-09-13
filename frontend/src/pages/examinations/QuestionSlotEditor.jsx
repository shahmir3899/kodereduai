import { Fragment, useMemo, useState } from 'react'
import RichTextEditor from '../../components/RichTextEditor'
import DiagramCanvas from '../../components/DiagramCanvas'
import QuestionBankPicker, { QUESTION_TYPES, getQuestionReuseCount, toDraftQuestionFromBank } from './QuestionBankPicker'
import { questionPaperApi } from '../../services/api'

// Maps the composer's option letters to the backend's diagram slot names / model
// fields (see QuestionViewSet.DIAGRAM_SLOT_FIELDS and Question.option_a_image_url
// etc. on the backend).
const OPTION_DIAGRAM_SLOTS = {
  A: 'option_a',
  B: 'option_b',
  C: 'option_c',
  D: 'option_d',
}

const QUESTION_TYPE_LABELS = QUESTION_TYPES.reduce((acc, type) => {
  acc[type.value] = type.label
  return acc
}, {})

const EMPTY_QUESTION = {
  local_id: null,
  question_id: null,
  question_text: '',
  question_image_url: null,
  question_type: 'SHORT',
  difficulty_level: 'MEDIUM',
  bloom_level: '',
  marks: 1,
  correct_answer: '',
  answer_text: '',
  answer_image_url: null,
  type_data: {},
  options: { A: '', B: '', C: '', D: '' },
  option_a_image_url: null,
  option_b_image_url: null,
  option_c_image_url: null,
  option_d_image_url: null,
  section_key: '',
}

const UNASSIGNED_SECTION = { key: '', title: 'Unassigned', question_type: 'SHORT', marks_per_question: 1 }

/**
 * QuestionSlotEditor - shared section/slot/composer engine for wizard Step 3.
 * `source="manual"` renders the original free-typing flow (ManualEntryPaperTab).
 * `source="bank"` additionally offers a per-slot "Add from bank" action, pre-filtered
 * to the section's question_type plus the caller-supplied topicIds (BankFillSource).
 * When `structure` is empty, falls back to a flat free-form list either way.
 */
export default function QuestionSlotEditor({
  draftData,
  onDraftDataChange,
  onSubmitDraft,
  isLoading,
  saveState,
  lastSavedAt,
  draftReady,
  draftAlreadyOpen = false,
  classId,
  subjectId,
  structure = [],
  overusedQuestionCounts = {},
  readOnly = false,
  source = 'manual',
  topicIds = [],
  hideFooter = false,
}) {
  const questions = draftData?.questions || []
  const hasStructure = structure.length > 0
  const isBankSource = source === 'bank'

  const [currentQuestion, setCurrentQuestion] = useState(EMPTY_QUESTION)
  const [composerTarget, setComposerTarget] = useState(null) // { sectionKey, localId }
  const [errors, setErrors] = useState({})
  const [showBankPicker, setShowBankPicker] = useState(false)
  // Which non-RichTextEditor diagram slot has its panel open -- 'option_A'..'option_D'
  // or 'answer'. Question-body diagrams are handled inside RichTextEditor itself; these
  // slots are plain <input>/<textarea> fields so DiagramCanvas is used standalone here.
  const [diagramSlotOpen, setDiagramSlotOpen] = useState(null)
  const [bankPickerSection, setBankPickerSection] = useState(null) // null = unassigned/global attach

  const saveStateLabel = useMemo(() => {
    if (isLoading || saveState === 'saving') return 'Saving...'
    if (saveState === 'saved' && lastSavedAt) {
      return `Saved ${new Date(lastSavedAt).toLocaleTimeString()}`
    }
    if (saveState === 'error') return 'Save failed'
    return draftReady ? 'Draft ready' : 'Draft not created yet'
  }, [draftReady, isLoading, lastSavedAt, saveState])

  const questionsBySection = useMemo(() => {
    const map = new Map()
    questions.forEach((question) => {
      const key = question.section_key || ''
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(question)
    })
    return map
  }, [questions])

  const unassignedQuestions = hasStructure ? (questionsBySection.get('') || []) : []

  const updateDraft = (updates) => {
    if (readOnly) return
    onDraftDataChange({
      ...(draftData || {}),
      ...updates,
    })
  }

  const resetQuestion = (overrides = {}) => {
    setCurrentQuestion({ ...EMPTY_QUESTION, options: { A: '', B: '', C: '', D: '' }, type_data: {}, ...overrides })
  }

  const openSlotComposer = (section, slotIndex = null) => {
    if (readOnly) return
    setComposerTarget({ sectionKey: section.key, localId: null, slotIndex })
    resetQuestion({
      question_type: section.question_type,
      marks: Number(section.marks_per_question) || 1,
      section_key: section.key,
    })
    setErrors({})
  }

  const openSlotEdit = (question, slotIndex = null) => {
    if (readOnly) return
    setComposerTarget({ sectionKey: question.section_key || '', localId: question.local_id, slotIndex })
    setCurrentQuestion({
      ...EMPTY_QUESTION,
      ...question,
      marks: Number(question.marks) || 1,
      type_data: question.type_data || {},
      options: question.options || {
        A: question.option_a || '',
        B: question.option_b || '',
        C: question.option_c || '',
        D: question.option_d || '',
      },
    })
    setErrors({})
  }

  const closeSlotComposer = () => {
    setComposerTarget(null)
    resetQuestion()
    setErrors({})
  }

  // Diagram Mode (question body only for now -- see RichTextEditor's `diagram` prop).
  // The upload endpoint is question-scoped (POST /questions/{id}/diagram/), but a
  // manually-typed question in this composer has no id until the paper is confirmed
  // server-side -- so the first diagram attach on a brand-new question silently
  // creates its Question row early (via the same bank-create endpoint QuestionsPage
  // uses), then uploads to it. This promotes the question into the bank a little
  // earlier than it otherwise would be, which is the intended trade-off: it's the
  // only way to give it a real id without a second, diagram-only draft-persistence
  // path. buildQuestionCreatePayload is deliberately separate from handleSaveQuestion's
  // own normalization below -- that one only ever writes to local draft state, this
  // one has to match what QuestionCreateUpdateSerializer accepts.
  const buildQuestionCreatePayload = (question) => {
    const payload = {
      subject: subjectId,
      question_text: question.question_text,
      question_type: question.question_type,
      difficulty_level: question.difficulty_level || 'MEDIUM',
      marks: Number(question.marks) || 1,
      correct_answer: question.correct_answer || '',
      answer_text: question.answer_text || '',
      type_data: question.type_data || {},
    }
    if (question.question_type === 'MCQ') {
      payload.option_a = question.options?.A || ''
      payload.option_b = question.options?.B || ''
      payload.option_c = question.options?.C || ''
      payload.option_d = question.options?.D || ''
    }
    if (question.question_type === 'FILL_BLANK') {
      const items = (question.type_data?.items || []).filter((value) => String(value || '').trim())
      payload.type_data = { ...payload.type_data, items, accepted_answers: items }
    }
    return payload
  }

  const ensureQuestionId = async () => {
    if (currentQuestion.question_id) return currentQuestion.question_id
    if (!subjectId) {
      throw new Error('Pick a subject for this paper before attaching a diagram.')
    }
    const { data } = await questionPaperApi.createQuestion(buildQuestionCreatePayload(currentQuestion))
    setCurrentQuestion((prev) => ({ ...prev, question_id: data.id }))
    return data.id
  }

  const handleQuestionDiagramInsert = async (file) => {
    try {
      const questionId = await ensureQuestionId()
      const { data } = await questionPaperApi.uploadQuestionDiagram(questionId, 'question', file)
      setCurrentQuestion((prev) => ({ ...prev, question_image_url: data.question_image_url }))
      setErrors((prev) => ({ ...prev, question_image_url: undefined }))
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        question_image_url: err?.response?.data?.error || err?.message || 'Failed to upload diagram.',
      }))
    }
  }

  const handleQuestionDiagramRemove = async () => {
    if (!currentQuestion.question_id) return
    try {
      await questionPaperApi.removeQuestionDiagram(currentQuestion.question_id, 'question')
      setCurrentQuestion((prev) => ({ ...prev, question_image_url: null }))
    } catch (err) {
      setErrors((prev) => ({ ...prev, question_image_url: err?.response?.data?.error || 'Failed to remove diagram.' }))
    }
  }

  // Same create-on-first-attach + upload/remove pair as the question body, generalized
  // over any slot's field name (option_a_image_url..option_d_image_url, answer_image_url).
  const handleSlotDiagramInsert = async (slot, fieldName, file) => {
    try {
      const questionId = await ensureQuestionId()
      const { data } = await questionPaperApi.uploadQuestionDiagram(questionId, slot, file)
      setCurrentQuestion((prev) => ({ ...prev, [fieldName]: data[fieldName] }))
      setErrors((prev) => ({ ...prev, [fieldName]: undefined }))
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [fieldName]: err?.response?.data?.error || err?.message || 'Failed to upload diagram.',
      }))
    }
    setDiagramSlotOpen(null)
  }

  const handleSlotDiagramRemove = async (slot, fieldName) => {
    if (!currentQuestion.question_id) return
    try {
      await questionPaperApi.removeQuestionDiagram(currentQuestion.question_id, slot)
      setCurrentQuestion((prev) => ({ ...prev, [fieldName]: null }))
    } catch (err) {
      setErrors((prev) => ({ ...prev, [fieldName]: err?.response?.data?.error || 'Failed to remove diagram.' }))
    }
  }

  const openBankPicker = (section) => {
    if (readOnly) return
    setBankPickerSection(section || null)
    setShowBankPicker(true)
  }

  const closeBankPicker = () => {
    setShowBankPicker(false)
    setBankPickerSection(null)
  }

  const handleBankAttach = (selectedQuestions) => {
    if (readOnly) return
    const section = bankPickerSection
    const existingIds = new Set(
      questions
        .map((question) => Number(question.question_id))
        .filter((value) => !Number.isNaN(value) && value > 0),
    )

    const additions = selectedQuestions
      .filter((question) => !existingIds.has(Number(question.id)))
      .map((question) => toDraftQuestionFromBank(question, section ? {
        section_key: section.key,
        marks: Number(section.marks_per_question) || 1,
        marks_override: Number(section.marks_per_question) || 1,
      } : {}))

    if (additions.length > 0) {
      updateDraft({ questions: [...questions, ...additions] })
    }
    closeBankPicker()
  }

  const handleSaveQuestion = () => {
    if (readOnly) return
    const newErrors = {}

    if (!currentQuestion.question_text.trim()) {
      newErrors.question_text = 'Question text is required'
    }

    if (currentQuestion.question_type === 'MCQ') {
      if (!currentQuestion.options.A || !currentQuestion.options.B) {
        newErrors.options = 'MCQ requires at least options A and B'
      }
    }

    // FILL_BLANK blanks/answers are optional -- a question can be created before the
    // answer is known and filled in later, same as FILL_BLANK's accepted_answers on
    // the question bank side (QuestionsPage.jsx).

    if (currentQuestion.question_type === 'MATCHING') {
      const pairs = (currentQuestion.type_data?.pairs || []).filter(
        (pair) => String(pair?.left || '').trim() && String(pair?.right || '').trim(),
      )
      if (pairs.length === 0) newErrors.type_data = 'Add at least one complete pair.'
    }

    if (currentQuestion.question_type === 'TRUE_FALSE') {
      if (!['true', 'false'].includes(String(currentQuestion.correct_answer || '').toLowerCase())) {
        newErrors.correct_answer = 'Select True or False'
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    const questionRecord = {
      ...currentQuestion,
      local_id: currentQuestion.local_id || `${Date.now()}_${Math.random()}`,
      marks: Number(currentQuestion.marks) || 1,
      marks_override: Number(currentQuestion.marks) || 1,
      section_key: currentQuestion.section_key || '',
    }

    // Backend grading validation reads type_data.accepted_answers, not the `items`
    // list the composer below collects (those are the printed blank-line prompts) —
    // mirror each blank's typed answer into accepted_answers so FILL_BLANK questions
    // don't fail autosave validation despite the teacher having filled every blank.
    if (questionRecord.question_type === 'FILL_BLANK') {
      const items = (questionRecord.type_data?.items || []).filter((value) => String(value || '').trim())
      questionRecord.type_data = { ...questionRecord.type_data, items, accepted_answers: items }
    }

    const nextQuestions = [...questions]
    if (currentQuestion.local_id) {
      const index = nextQuestions.findIndex((q) => q.local_id === currentQuestion.local_id)
      if (index >= 0) {
        nextQuestions[index] = questionRecord
      } else {
        nextQuestions.push(questionRecord)
      }
    } else {
      nextQuestions.push(questionRecord)
    }

    updateDraft({ questions: nextQuestions })

    if (composerTarget) {
      setComposerTarget(null)
    }
    resetQuestion()
    setErrors({})
  }

  const handleRemoveQuestion = (localId) => {
    if (readOnly) return
    updateDraft({ questions: questions.filter((q) => q.local_id !== localId) })
    if (composerTarget?.localId === localId) {
      closeSlotComposer()
    }
  }

  const handleAssignSection = (localId, sectionKey) => {
    if (readOnly || !sectionKey) return
    updateDraft({
      questions: questions.map((q) => (q.local_id === localId ? { ...q, section_key: sectionKey } : q)),
    })
  }

  const moveQuestionWithinSection = (localId, direction) => {
    if (readOnly) return
    const currentIndex = questions.findIndex((q) => q.local_id === localId)
    if (currentIndex === -1) return
    const sectionKey = questions[currentIndex].section_key || ''
    const sectionIndices = questions.reduce((acc, q, i) => {
      if ((q.section_key || '') === sectionKey) acc.push(i)
      return acc
    }, [])
    const posInSection = sectionIndices.indexOf(currentIndex)
    const targetPos = posInSection + direction
    if (targetPos < 0 || targetPos >= sectionIndices.length) return

    const idxA = sectionIndices[posInSection]
    const idxB = sectionIndices[targetPos]
    const next = [...questions]
    ;[next[idxA], next[idxB]] = [next[idxB], next[idxA]]
    updateDraft({ questions: next })
  }

  const calculateTotal = () => {
    return questions.reduce((sum, q) => sum + (Number(q.marks_override ?? q.marks) || 0), 0)
  }

  const handleCreatePaper = async (e) => {
    e.preventDefault()
    if (readOnly) return

    const newErrors = {}

    // This field lives on Step 1 (Paper Setup), not here on Step 3 -- say so
    // explicitly, since a bare "Paper title is required" next to this button gives
    // no clue where to actually go fix it.
    if (!(draftData?.paper_title || '').trim()) newErrors.paperTitle = 'Paper title is required — set it in Step 1: Paper Setup.'
    if (questions.length === 0) newErrors.questions = 'Add at least one question'

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    // Clear any stale paperTitle/questions error from a prior failed attempt -- it
    // was never cleared on success before, so fixing the title and resubmitting
    // still showed the old "Paper title is required" message even though this
    // submission is going through fine.
    setErrors({})
    onSubmitDraft()
  }

  const currentTotal = calculateTotal()

  const renderQuestionPreview = (question) => (
    <>
      <div
        className="text-sm text-gray-600 mt-1 line-clamp-2"
        dangerouslySetInnerHTML={{ __html: question.question_text }}
      />
      {question.question_type === 'FILL_BLANK' && (
        <p className="text-xs text-gray-500 mt-1">{(question.type_data?.items || []).length} blank(s)</p>
      )}
      {question.question_type === 'MATCHING' && (
        <p className="text-xs text-gray-500 mt-1">{(question.type_data?.pairs || []).length} pair(s)</p>
      )}
    </>
  )

  const renderComposer = ({ heading, onCancel, onReset }) => (
    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 bg-gray-50">
      <div className="flex flex-wrap items-center justify-between mb-4 gap-2">
        <h3 className="text-lg font-semibold text-gray-800">{heading}</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openBankPicker(null)}
            disabled={!classId || !subjectId}
            className="px-3 py-1.5 border border-blue-300 text-blue-700 rounded-lg text-sm hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="sm:hidden">From Bank</span>
            <span className="hidden sm:inline">Load from Question Bank</span>
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-100"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Question Type and Marks */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Question Type
          </label>
          <select
            value={currentQuestion.question_type}
            onChange={(e) =>
              setCurrentQuestion({ ...currentQuestion, question_type: e.target.value })
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {QUESTION_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Marks
          </label>
          <input
            type="number"
            value={currentQuestion.marks}
            onChange={(e) =>
              setCurrentQuestion({ ...currentQuestion, marks: parseFloat(e.target.value) })
            }
            min="0.5"
            step="0.5"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="flex items-end">
          <div className="text-sm text-gray-600">
            Running Total: <span className="font-bold text-lg">{currentTotal}</span>
          </div>
        </div>
      </div>

      {/* Question Text */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Question Text *
        </label>
        <RichTextEditor
          value={currentQuestion.question_text}
          onChange={(html) =>
            setCurrentQuestion({ ...currentQuestion, question_text: html })
          }
          placeholder="Type your question here..."
          diagram={{
            imageUrl: currentQuestion.question_image_url,
            targetLabel: 'Question body',
            onInsert: handleQuestionDiagramInsert,
            onRemove: currentQuestion.question_image_url ? handleQuestionDiagramRemove : undefined,
          }}
        />
        {errors.question_text && (
          <p className="text-red-500 text-sm mt-1">{errors.question_text}</p>
        )}
        {errors.question_image_url && (
          <p className="text-red-500 text-sm mt-1">{errors.question_image_url}</p>
        )}
        {!currentQuestion.question_id && (
          <p className="text-xs text-gray-400 mt-1">
            Attaching a diagram saves this question to the question bank right away, ahead of the rest of the paper.
          </p>
        )}
      </div>

      {/* MCQ Options */}
      {currentQuestion.question_type === 'MCQ' && (
        <div className="space-y-3 mb-4 bg-white p-4 rounded border border-gray-200">
          <p className="text-sm font-semibold text-gray-700">MCQ Options</p>
          {['A', 'B', 'C', 'D'].map((option) => {
            const slot = OPTION_DIAGRAM_SLOTS[option]
            const fieldName = `${slot}_image_url`
            const imageUrl = currentQuestion[fieldName]
            const slotKey = `option_${option}`
            const isOpen = diagramSlotOpen === slotKey
            return (
              <Fragment key={option}>
                <div className="flex gap-2">
                  <label className="font-bold text-gray-700 w-6 pt-2">{option}.</label>
                  <input
                    type="text"
                    value={currentQuestion.options[option]}
                    onChange={(e) =>
                      setCurrentQuestion({
                        ...currentQuestion,
                        options: { ...currentQuestion.options, [option]: e.target.value },
                      })
                    }
                    placeholder={`Option ${option}`}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => setDiagramSlotOpen(isOpen ? null : slotKey)}
                    title={`Draw or paste a diagram for option ${option} (e.g. "which shape is a rhombus?")`}
                    className={`w-10 h-10 flex-none rounded border overflow-hidden flex items-center justify-center ${isOpen ? 'border-emerald-500 ring-2 ring-emerald-200' : imageUrl ? 'border-gray-300' : 'border-dashed border-gray-300 text-gray-400'}`}
                  >
                    {imageUrl ? (
                      <img src={imageUrl} alt={`Option ${option} diagram`} className="w-full h-full object-contain bg-white" />
                    ) : (
                      <span className="text-[9px] leading-tight">Draw</span>
                    )}
                  </button>
                </div>
                {errors[fieldName] && <p className="text-red-500 text-xs ml-8">{errors[fieldName]}</p>}
                {isOpen && (
                  <div className="ml-8">
                    <DiagramCanvas
                      targetLabel={`Option ${option}`}
                      onClose={() => setDiagramSlotOpen(null)}
                      onInsert={(file) => handleSlotDiagramInsert(slot, fieldName, file)}
                    />
                    {imageUrl && (
                      <button
                        type="button"
                        onClick={() => handleSlotDiagramRemove(slot, fieldName)}
                        className="text-xs text-red-600 hover:underline mt-1"
                      >
                        Remove diagram
                      </button>
                    )}
                  </div>
                )}
              </Fragment>
            )
          })}
          {errors.options && <p className="text-red-500 text-sm">{errors.options}</p>}
          {!currentQuestion.question_id && (
            <p className="text-xs text-gray-400">
              Attaching a diagram saves this question to the question bank right away, ahead of the rest of the paper.
            </p>
          )}
        </div>
      )}

      {/* True / False answer key */}
      {currentQuestion.question_type === 'TRUE_FALSE' && (
        <div className="space-y-2 mb-4 bg-white p-4 rounded border border-gray-200">
          <p className="text-sm font-semibold text-gray-700">Correct Answer</p>
          <div className="flex gap-4">
            {['true', 'false'].map((value) => (
              <label key={value} className="flex items-center gap-2 text-sm text-gray-700 capitalize">
                <input
                  type="radio"
                  name="true_false_answer"
                  checked={String(currentQuestion.correct_answer || '').toLowerCase() === value}
                  onChange={() => setCurrentQuestion({ ...currentQuestion, correct_answer: value })}
                />
                {value}
              </label>
            ))}
          </div>
          {errors.correct_answer && <p className="text-red-500 text-sm">{errors.correct_answer}</p>}
        </div>
      )}

      {/* Fill in the Blanks */}
      {currentQuestion.question_type === 'FILL_BLANK' && (
        <div className="space-y-2 mb-4 bg-white p-4 rounded border border-gray-200">
          <p className="text-sm font-semibold text-gray-700">Blanks</p>
          {(currentQuestion.type_data?.items || []).map((item, idx) => (
            <div key={idx} className="flex gap-2">
              <span className="text-xs text-gray-500 w-16 pt-2">Blank {idx + 1}</span>
              <input
                type="text"
                value={item}
                onChange={(e) => {
                  const items = [...(currentQuestion.type_data?.items || [])]
                  items[idx] = e.target.value
                  setCurrentQuestion({ ...currentQuestion, type_data: { ...currentQuestion.type_data, items } })
                }}
                placeholder={`Answer for blank ${idx + 1}`}
                className="flex-1 px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => {
                  const items = (currentQuestion.type_data?.items || []).filter((_, i) => i !== idx)
                  setCurrentQuestion({ ...currentQuestion, type_data: { ...currentQuestion.type_data, items } })
                }}
                className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              const items = [...(currentQuestion.type_data?.items || []), '']
              setCurrentQuestion({ ...currentQuestion, type_data: { ...currentQuestion.type_data, items } })
            }}
            className="px-3 py-1.5 border border-dashed border-gray-300 rounded text-sm text-gray-600 hover:bg-gray-50"
          >
            + Add Blank
          </button>
          {errors.type_data && <p className="text-red-500 text-sm">{errors.type_data}</p>}
        </div>
      )}

      {/* Matching Pairs */}
      {currentQuestion.question_type === 'MATCHING' && (
        <div className="space-y-2 mb-4 bg-white p-4 rounded border border-gray-200">
          <p className="text-sm font-semibold text-gray-700">Matching Pairs</p>
          {(currentQuestion.type_data?.pairs || []).map((pair, idx) => (
            <div key={idx} className="flex gap-2 items-center">
              <input
                type="text"
                value={pair.left || ''}
                onChange={(e) => {
                  const pairs = [...(currentQuestion.type_data?.pairs || [])]
                  pairs[idx] = { ...pairs[idx], left: e.target.value }
                  setCurrentQuestion({ ...currentQuestion, type_data: { ...currentQuestion.type_data, pairs } })
                }}
                placeholder="Left"
                className="flex-1 px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <span className="text-gray-400">↔</span>
              <input
                type="text"
                value={pair.right || ''}
                onChange={(e) => {
                  const pairs = [...(currentQuestion.type_data?.pairs || [])]
                  pairs[idx] = { ...pairs[idx], right: e.target.value }
                  setCurrentQuestion({ ...currentQuestion, type_data: { ...currentQuestion.type_data, pairs } })
                }}
                placeholder="Right"
                className="flex-1 px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => {
                  const pairs = (currentQuestion.type_data?.pairs || []).filter((_, i) => i !== idx)
                  setCurrentQuestion({ ...currentQuestion, type_data: { ...currentQuestion.type_data, pairs } })
                }}
                className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              const pairs = [...(currentQuestion.type_data?.pairs || []), { left: '', right: '' }]
              setCurrentQuestion({ ...currentQuestion, type_data: { ...currentQuestion.type_data, pairs } })
            }}
            className="px-3 py-1.5 border border-dashed border-gray-300 rounded text-sm text-gray-600 hover:bg-gray-50"
          >
            + Add Pair
          </button>
          {errors.type_data && <p className="text-red-500 text-sm">{errors.type_data}</p>}
        </div>
      )}

      {/* Model answer (used for grading — required by the backend for SHORT/LONG/ESSAY) */}
      {['SHORT', 'LONG', 'ESSAY'].includes(currentQuestion.question_type) && (
        <div className="space-y-2 mb-4 bg-white p-4 rounded border border-gray-200">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">Model Answer / Marking Guide</p>
            <button
              type="button"
              onClick={() => setDiagramSlotOpen(diagramSlotOpen === 'answer' ? null : 'answer')}
              className={`text-xs px-2 py-1 rounded border ${diagramSlotOpen === 'answer' ? 'border-emerald-500 text-emerald-700 bg-emerald-50' : 'border-gray-300 text-gray-600'}`}
            >
              ✎ {currentQuestion.answer_image_url ? 'Diagram attached' : 'Add diagram'}
            </button>
          </div>
          <textarea
            value={currentQuestion.answer_text}
            onChange={(e) => setCurrentQuestion({ ...currentQuestion, answer_text: e.target.value })}
            placeholder="What should a correct answer contain? Used for grading, not printed on the paper."
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {errors.answer_text && <p className="text-red-500 text-sm">{errors.answer_text}</p>}
          {errors.answer_image_url && <p className="text-red-500 text-sm">{errors.answer_image_url}</p>}

          {currentQuestion.answer_image_url && diagramSlotOpen !== 'answer' && (
            <div className="flex items-center gap-2">
              <div className="w-14 h-14 border border-gray-300 rounded overflow-hidden bg-white flex-none">
                <img src={currentQuestion.answer_image_url} alt="Model answer diagram" className="w-full h-full object-contain" />
              </div>
              <span className="text-xs text-gray-400">Worked-out diagram, teacher-facing only.</span>
            </div>
          )}
          {diagramSlotOpen === 'answer' && (
            <div>
              <DiagramCanvas
                targetLabel="Model answer"
                onClose={() => setDiagramSlotOpen(null)}
                onInsert={(file) => handleSlotDiagramInsert('answer', 'answer_image_url', file)}
              />
              {currentQuestion.answer_image_url && (
                <button
                  type="button"
                  onClick={() => handleSlotDiagramRemove('answer', 'answer_image_url')}
                  className="text-xs text-red-600 hover:underline mt-1"
                >
                  Remove diagram
                </button>
              )}
            </div>
          )}
          {!currentQuestion.question_id && (
            <p className="text-xs text-gray-400">
              Attaching a diagram saves this question to the question bank right away, ahead of the rest of the paper.
            </p>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2 justify-end">
        <button
          onClick={onReset}
          type="button"
          className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100"
        >
          Reset
        </button>
        <button
          onClick={handleSaveQuestion}
          type="button"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          {currentQuestion.local_id ? 'Save Question' : 'Add Question'}
        </button>
      </div>
    </div>
  )

  const renderEmptySlot = (section, slotIndex) => {
    const label = QUESTION_TYPE_LABELS[section.question_type] || section.question_type
    return (
      <div
        key={`empty_${section.key}_${slotIndex}`}
        className="flex items-center justify-between border border-dashed border-gray-300 rounded-lg px-3 py-2 bg-white"
      >
        <span className="text-sm text-gray-500">
          {label} {slotIndex + 1} of {section.slots_shown} — {section.marks_per_question} marks
        </span>
        {!readOnly && (
          <div className="flex gap-2">
            {isBankSource && (
              <button
                type="button"
                onClick={() => openBankPicker(section)}
                disabled={!classId || !subjectId}
                className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add from bank
              </button>
            )}
            <button
              type="button"
              onClick={() => openSlotComposer(section, slotIndex)}
              className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
            >
              {isBankSource ? 'Type manually' : 'Add question'}
            </button>
          </div>
        )}
      </div>
    )
  }

  const renderFilledSlot = (question, slotIndex, sectionQuestions, overflow = false) => {
    const useCount = getQuestionReuseCount(question, overusedQuestionCounts)
    const isOverused = useCount >= 3
    return (
      <div
        key={question.local_id}
        className="flex flex-col sm:flex-row gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg"
      >
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-800 flex flex-wrap items-center gap-2">
            <span>
              Slot {slotIndex + 1}{overflow ? ' (overflow)' : ''}. {question.question_type} [{question.marks}M]
            </span>
            {isOverused && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                Used in {useCount} papers
              </span>
            )}
          </div>
          {renderQuestionPreview(question)}
        </div>
        <div className="flex flex-row sm:flex-col gap-1 items-center sm:items-end shrink-0">
          {!readOnly && (
            <>
              <div className="flex gap-1">
                <button
                  onClick={() => moveQuestionWithinSection(question.local_id, -1)}
                  disabled={slotIndex === 0}
                  className="px-2 py-1 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ↑
                </button>
                <button
                  onClick={() => moveQuestionWithinSection(question.local_id, 1)}
                  disabled={slotIndex === sectionQuestions.length - 1}
                  className="px-2 py-1 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ↓
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => openSlotEdit(question, slotIndex)}
                  className="px-2 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleRemoveQuestion(question.local_id)}
                  className="px-2 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
                >
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  const renderDivider = (section) => (
    <div key={section.local_id || section.key} className="pt-2 pb-1 border-b-2 border-gray-300">
      <h3 className="text-base font-bold text-gray-800 uppercase tracking-wide">{section.title}</h3>
    </div>
  )

  const renderSection = (section) => {
    if (section.type === 'divider') return renderDivider(section)

    const sectionQuestions = questionsBySection.get(section.key) || []
    const slotsCounted = Number(section.slots_counted ?? section.slots_shown ?? 0) || 0
    const marksPerQuestion = Number(section.marks_per_question ?? 0) || 0
    const sectionMarksTotal = slotsCounted * marksPerQuestion
    const typeLabel = QUESTION_TYPE_LABELS[section.question_type] || section.question_type
    const isOverflow = sectionQuestions.length > section.slots_shown

    // Anchors the composer directly under whichever slot triggered it (openSlotComposer/
    // openSlotEdit record that slotIndex) instead of always appending it after every slot in
    // the section — with 5 fill-in-the-blank slots, "add question 1" popping up under slot 5
    // reads as if it belongs to the wrong question.
    const renderComposerForSlot = (slotIndex) => {
      if (readOnly || composerTarget?.sectionKey !== section.key || composerTarget?.slotIndex !== slotIndex) {
        return null
      }
      return (
        <div className="pt-2">
          {renderComposer({
            heading: composerTarget.localId ? 'Edit Question' : `Add question — ${section.title}`,
            onCancel: closeSlotComposer,
            onReset: () => resetQuestion({
              question_type: section.question_type,
              marks: Number(section.marks_per_question) || 1,
              section_key: section.key,
            }),
          })}
        </div>
      )
    }

    return (
      <div key={section.key} className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
          <p className="font-semibold text-gray-800">
            {section.title} — {typeLabel} — {slotsCounted}×{marksPerQuestion} = {sectionMarksTotal} marks
          </p>
          {section.instruction && <p className="text-sm text-gray-600 mt-1">{section.instruction}</p>}
        </div>
        <div className="p-4 space-y-2">
          {Array.from({ length: section.slots_shown }).map((_, slotIndex) => {
            const question = sectionQuestions[slotIndex]
            return (
              <Fragment key={`slot_${section.key}_${slotIndex}`}>
                {question
                  ? renderFilledSlot(question, slotIndex, sectionQuestions)
                  : renderEmptySlot(section, slotIndex)}
                {renderComposerForSlot(slotIndex)}
              </Fragment>
            )
          })}

          {sectionQuestions.slice(section.slots_shown).map((question, idx) => {
            const slotIndex = section.slots_shown + idx
            return (
              <Fragment key={`overflow_${section.key}_${slotIndex}`}>
                {renderFilledSlot(question, slotIndex, sectionQuestions, true)}
                {renderComposerForSlot(slotIndex)}
              </Fragment>
            )
          })}

          {isOverflow && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              {sectionQuestions.length} questions in a {section.slots_shown}-slot section
            </p>
          )}

          {/* Fallback: composer targets this section but not a specific slot (e.g. slot
              index no longer exists after structure changed) -- keep old bottom placement
              rather than silently dropping the open composer. */}
          {!readOnly && composerTarget?.sectionKey === section.key && composerTarget?.slotIndex == null && (
            <div className="pt-2">
              {renderComposer({
                heading: composerTarget.localId ? 'Edit Question' : `Add question — ${section.title}`,
                onCancel: closeSlotComposer,
                onReset: () => resetQuestion({
                  question_type: section.question_type,
                  marks: Number(section.marks_per_question) || 1,
                  section_key: section.key,
                }),
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {readOnly && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This paper is finalized and is opened in read-only mode.
        </div>
      )}

      {!hasStructure && (
        <>
          {/* Legacy free-form composer */}
          {!readOnly && renderComposer({
            heading: `Add Question ${questions.length + 1}`,
            onCancel: null,
            onReset: () => resetQuestion(),
          })}

          {/* Questions List */}
          {questions.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-gray-800">
                Questions ({questions.length})
              </h3>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {questions.map((q, idx) => {
                  const useCount = getQuestionReuseCount(q, overusedQuestionCounts)
                  const isOverused = useCount >= 3

                  return (
                    <div
                      key={q.local_id || q.id || `${idx}`}
                      className="flex gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg"
                    >
                      <div className="flex-1">
                        <div className="font-semibold text-gray-800 flex flex-wrap items-center gap-2">
                          <span>Q{idx + 1}. {q.question_type} [{q.marks}M]</span>
                          {isOverused && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                              Used in {useCount} papers
                            </span>
                          )}
                        </div>
                        {renderQuestionPreview(q)}
                      </div>
                      <div className="flex gap-2">
                        {!readOnly && (
                          <>
                            <button
                              onClick={() => openSlotEdit(q)}
                              className="px-2 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleRemoveQuestion(q.local_id)}
                              className="px-2 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}

      {hasStructure && (
        <>
          {!readOnly && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => openBankPicker(null)}
                disabled={!classId || !subjectId}
                className="px-3 py-1.5 border border-blue-300 text-blue-700 rounded-lg text-sm hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Load from Question Bank
              </button>
            </div>
          )}

          <div className="space-y-4">
            {structure.map((section) => renderSection(section))}
          </div>

          {(unassignedQuestions.length > 0 || (!readOnly && composerTarget?.sectionKey === '')) && (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                <p className="font-semibold text-gray-800">Unassigned Questions</p>
                <p className="text-xs text-gray-500 mt-1">Not linked to a structure section yet.</p>
              </div>
              <div className="p-4 space-y-2">
                {unassignedQuestions.map((question) => (
                  <Fragment key={question.local_id}>
                    <div className="flex gap-3 p-3 bg-white border border-gray-200 rounded-lg">
                      <div className="flex-1">
                        <div className="font-semibold text-gray-800">
                          {question.question_type} [{question.marks}M]
                        </div>
                        {renderQuestionPreview(question)}
                      </div>
                      <div className="flex flex-col gap-2 items-end">
                        {!readOnly && (
                          <>
                            <select
                              value=""
                              onChange={(e) => handleAssignSection(question.local_id, e.target.value)}
                              className="text-xs border border-gray-300 rounded px-2 py-1"
                            >
                              <option value="">Assign to section...</option>
                              {structure.filter((section) => section.type !== 'divider').map((section) => (
                                <option key={section.key} value={section.key}>{section.title}</option>
                              ))}
                            </select>
                            <div className="flex gap-2">
                              <button
                                onClick={() => openSlotEdit(question)}
                                className="px-2 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleRemoveQuestion(question.local_id)}
                                className="px-2 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
                              >
                                Delete
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    {/* Anchor the edit composer directly under the question being edited
                        instead of always at the bottom of the unassigned list. */}
                    {!readOnly && composerTarget?.sectionKey === '' && composerTarget?.localId === question.local_id && (
                      <div className="pt-2">
                        {renderComposer({
                          heading: 'Edit Question',
                          onCancel: closeSlotComposer,
                          onReset: () => resetQuestion({ section_key: '' }),
                        })}
                      </div>
                    )}
                  </Fragment>
                ))}

                {!readOnly && composerTarget?.sectionKey === '' && !composerTarget?.localId && (
                  renderComposer({
                    heading: 'Add unassigned question',
                    onCancel: closeSlotComposer,
                    onReset: () => resetQuestion({ section_key: '' }),
                  })
                )}
              </div>
            </div>
          )}

          {!readOnly && !composerTarget && (
            <button
              type="button"
              onClick={() => openSlotComposer(UNASSIGNED_SECTION)}
              className="w-full px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
            >
              + Add question without a section
            </button>
          )}
        </>
      )}

      <QuestionBankPicker
        open={!readOnly && showBankPicker}
        onClose={closeBankPicker}
        classId={classId}
        subjectId={subjectId}
        topicIds={isBankSource ? topicIds : []}
        lockedQuestionType={bankPickerSection ? bankPickerSection.question_type : undefined}
        excludeQuestionIds={questions.map((q) => q.question_id).filter(Boolean)}
        overusedQuestionCounts={overusedQuestionCounts}
        onAttach={handleBankAttach}
      />

      {/* Submit */}
      {!hideFooter && !readOnly && questions.length > 0 && (
        <div className="flex gap-2 justify-end pt-4 border-t border-gray-200">
          <div className={`mr-auto text-sm ${saveState === 'error' ? 'text-red-600' : 'text-gray-600'}`}>
            {saveStateLabel}
          </div>
          {errors.paperTitle && <p className="text-red-500 text-sm">{errors.paperTitle}</p>}
          {errors.questions && <p className="text-red-500 text-sm">{errors.questions}</p>}
          <button
            onClick={handleCreatePaper}
            disabled={isLoading}
            className={`px-6 py-2 rounded-lg font-medium ${
              isLoading
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            {isLoading
              ? 'Saving...'
              // Once you're already viewing this draft's own page, clicking here just
              // saves in place (there's nowhere new to navigate to) -- label it as
              // such instead of "Open Draft", which implied it would take you somewhere.
              : draftReady
                ? (draftAlreadyOpen ? 'Save Draft' : 'Open Draft')
                : 'Create Draft'}
          </button>
        </div>
      )}
    </div>
  )
}
