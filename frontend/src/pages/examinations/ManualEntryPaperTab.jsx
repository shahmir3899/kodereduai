import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import RichTextEditor from '../../components/RichTextEditor'
import { questionPaperApi } from '../../services/api'

/**
 * ManualEntryPaperTab - Manually create exam papers by typing
 */
export default function ManualEntryPaperTab({
  draftData,
  onDraftDataChange,
  onSubmitDraft,
  isLoading,
  saveState,
  lastSavedAt,
  draftReady,
  classId,
  subjectId,
  overusedQuestionCounts = {},
  readOnly = false,
}) {
  const questions = draftData?.questions || []

  const [currentQuestion, setCurrentQuestion] = useState({
    local_id: null,
    question_id: null,
    question_text: '',
    question_type: 'SHORT',
    difficulty_level: 'MEDIUM',
    bloom_level: '',
    marks: 1,
    correct_answer: '',
    answer_text: '',
    options: { A: '', B: '', C: '', D: '' },
  })
  const [errors, setErrors] = useState({})
  const [showBankPicker, setShowBankPicker] = useState(false)
  const [bankSearch, setBankSearch] = useState('')
  const [bankType, setBankType] = useState('')
  const [bankDifficulty, setBankDifficulty] = useState('')
  const [selectedBankIds, setSelectedBankIds] = useState([])

  const questionTypes = [
    { value: 'MCQ', label: 'Multiple Choice' },
    { value: 'SHORT', label: 'Short Answer' },
    { value: 'LONG', label: 'Long Answer' },
    { value: 'ESSAY', label: 'Essay' },
    { value: 'TRUE_FALSE', label: 'True/False' },
    { value: 'MATCHING', label: 'Matching' },
    { value: 'FILL_BLANK', label: 'Fill in the Blanks' },
  ]

  const saveStateLabel = useMemo(() => {
    if (isLoading || saveState === 'saving') return 'Saving...'
    if (saveState === 'saved' && lastSavedAt) {
      return `Saved ${new Date(lastSavedAt).toLocaleTimeString()}`
    }
    if (saveState === 'error') return 'Save failed'
    return draftReady ? 'Draft ready' : 'Draft not created yet'
  }, [draftReady, isLoading, lastSavedAt, saveState])

  const bankQueryParams = useMemo(() => ({
    ...(classId && { class_id: classId }),
    ...(subjectId && { subject: subjectId }),
    ...(bankSearch.trim() && { search: bankSearch.trim() }),
    ...(bankType && { question_type: bankType }),
    ...(bankDifficulty && { difficulty_level: bankDifficulty }),
    page_size: 50,
  }), [bankDifficulty, bankSearch, bankType, classId, subjectId])

  const { data: bankData, isLoading: bankLoading } = useQuery({
    queryKey: ['paperBuilderQuestionBankPicker', bankQueryParams],
    queryFn: () => questionPaperApi.getQuestions(bankQueryParams),
    enabled: showBankPicker && !!classId && !!subjectId,
  })

  const bankQuestions = bankData?.data?.results || bankData?.data || []

  const getQuestionReuseCount = (question) => {
    const directCount = Number(question?.paper_use_count)
    if (Number.isFinite(directCount)) return directCount

    const questionId = Number(question?.id ?? question?.question_id)
    if (!Number.isFinite(questionId)) return 0

    const mappedCount = Number(overusedQuestionCounts?.[questionId])
    return Number.isFinite(mappedCount) ? mappedCount : 0
  }

  const updateDraft = (updates) => {
    if (readOnly) return
    onDraftDataChange({
      ...(draftData || {}),
      ...updates,
    })
  }

  const toggleBankQuestion = (questionId) => {
    if (readOnly) return
    const id = Number(questionId)
    setSelectedBankIds((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id)
      return [...prev, id]
    })
  }

  const attachSelectedBankQuestions = () => {
    if (readOnly) return
    const selectedQuestions = bankQuestions.filter((question) => selectedBankIds.includes(question.id))
    if (selectedQuestions.length === 0) return

    const existingIds = new Set(
      questions
        .map((question) => Number(question.question_id))
        .filter((value) => !Number.isNaN(value) && value > 0),
    )

    const additions = selectedQuestions
      .filter((question) => !existingIds.has(Number(question.id)))
      .map((question) => ({
        local_id: `bank_${question.id}_${Date.now()}_${Math.random()}`,
        question_id: question.id,
        paper_use_count: getQuestionReuseCount(question),
        question_text: question.question_text || '',
        question_type: question.question_type || 'SHORT',
        difficulty_level: question.difficulty_level || 'MEDIUM',
        bloom_level: question.bloom_level || '',
        marks: Number(question.marks ?? 1) || 1,
        marks_override: Number(question.marks ?? 1) || 1,
        correct_answer: question.correct_answer || '',
        answer_text: question.answer_text || '',
        type_data: question.type_data || {},
        tested_topics: Array.isArray(question.tested_topics) ? question.tested_topics : [],
        options: {
          A: question.option_a || '',
          B: question.option_b || '',
          C: question.option_c || '',
          D: question.option_d || '',
        },
      }))

    if (additions.length === 0) {
      setShowBankPicker(false)
      setSelectedBankIds([])
      return
    }

    updateDraft({ questions: [...questions, ...additions] })
    setShowBankPicker(false)
    setSelectedBankIds([])
  }

  // Add question to list
  const handleAddQuestion = () => {
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

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    const questionRecord = {
      ...currentQuestion,
      local_id: currentQuestion.local_id || `${Date.now()}_${Math.random()}`,
      marks: Number(currentQuestion.marks) || 1,
      marks_override: Number(currentQuestion.marks) || 1,
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
    resetQuestion()
    setErrors({})
  }

  const resetQuestion = () => {
    setCurrentQuestion({
      local_id: null,
      question_id: null,
      question_text: '',
      question_type: 'SHORT',
      difficulty_level: 'MEDIUM',
      bloom_level: '',
      marks: 1,
      correct_answer: '',
      answer_text: '',
      options: { A: '', B: '', C: '', D: '' },
    })
  }

  // Remove question from list
  const handleRemoveQuestion = (localId) => {
    if (readOnly) return
    updateDraft({ questions: questions.filter((q) => q.local_id !== localId) })
  }

  // Update question in list
  const handleEditQuestion = (localId) => {
    if (readOnly) return
    const q = questions.find((item) => item.local_id === localId)
    if (!q) return
    setCurrentQuestion({
      ...q,
      marks: Number(q.marks) || 1,
      options: q.options || { A: q.option_a || '', B: q.option_b || '', C: q.option_c || '', D: q.option_d || '' },
    })
  }

  // Calculate total from questions
  const calculateTotal = () => {
    return questions.reduce((sum, q) => sum + (Number(q.marks_override ?? q.marks) || 0), 0)
  }

  // Handle form submission
  const handleCreatePaper = async (e) => {
    e.preventDefault()
    if (readOnly) return

    const newErrors = {}

    if (!(draftData?.paper_title || '').trim()) newErrors.paperTitle = 'Paper title is required'
    if (questions.length === 0) newErrors.questions = 'Add at least one question'

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    onSubmitDraft()
  }

  const currentTotal = calculateTotal()

  return (
    <div className="space-y-6">
      {readOnly && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This paper is finalized and is opened in read-only mode.
        </div>
      )}

      {/* Paper Metadata */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Paper Title *
          </label>
          <input
            type="text"
            value={draftData?.paper_title || ''}
            onChange={(e) => updateDraft({ paper_title: e.target.value })}
            placeholder="e.g., Physics Mid-Term 2026"
            disabled={readOnly}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {errors.paperTitle && <p className="text-red-500 text-sm mt-1">{errors.paperTitle}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Total Marks
          </label>
          <input
            type="number"
            value={draftData?.total_marks || '100'}
            onChange={(e) => updateDraft({ total_marks: e.target.value })}
            disabled={readOnly}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Duration (minutes)
          </label>
          <input
            type="number"
            value={draftData?.duration_minutes || '60'}
            onChange={(e) => updateDraft({ duration_minutes: e.target.value })}
            disabled={readOnly}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Questions Count
          </label>
          <div className="text-2xl font-bold text-blue-600">{questions.length}</div>
        </div>
      </div>

      {/* Instructions */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Instructions
        </label>
        <textarea
          value={draftData?.instructions || ''}
          onChange={(e) => updateDraft({ instructions: e.target.value })}
          placeholder="Enter general instructions for students..."
          rows="4"
          disabled={readOnly}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Question Form */}
      {!readOnly && (
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 bg-gray-50">
        <div className="flex items-center justify-between mb-4 gap-2">
          <h3 className="text-lg font-semibold text-gray-800">
            Add Question {questions.length + 1}
          </h3>
          <button
            type="button"
            onClick={() => setShowBankPicker(true)}
            disabled={!classId || !subjectId}
            className="px-3 py-1.5 border border-blue-300 text-blue-700 rounded-lg text-sm hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Load from Question Bank
          </button>
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
              {questionTypes.map((type) => (
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
          />
          {errors.question_text && (
            <p className="text-red-500 text-sm mt-1">{errors.question_text}</p>
          )}
        </div>

        {/* MCQ Options */}
        {currentQuestion.question_type === 'MCQ' && (
          <div className="space-y-3 mb-4 bg-white p-4 rounded border border-gray-200">
            <p className="text-sm font-semibold text-gray-700">MCQ Options</p>
            {['A', 'B', 'C', 'D'].map((option) => (
              <div key={option} className="flex gap-2">
                <label className="font-bold text-gray-700 w-6">{option}.</label>
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
              </div>
            ))}
            {errors.options && <p className="text-red-500 text-sm">{errors.options}</p>}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2 justify-end">
          <button
            onClick={resetQuestion}
            type="button"
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100"
          >
            Reset
          </button>
          <button
            onClick={handleAddQuestion}
            type="button"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Add Question
          </button>
        </div>
      </div>
      )}

      {/* Questions List */}
      {questions.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-gray-800">
            Questions ({questions.length})
          </h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {questions.map((q, idx) => {
              const useCount = getQuestionReuseCount(q)
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
                  <div
                    className="text-sm text-gray-600 mt-1 line-clamp-2"
                    dangerouslySetInnerHTML={{ __html: q.question_text }}
                  />
                </div>
                <div className="flex gap-2">
                  {!readOnly && (
                    <>
                      <button
                        onClick={() => handleEditQuestion(q.local_id)}
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

      {!readOnly && showBankPicker && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-4xl max-h-[85vh] overflow-hidden border border-gray-200 shadow-xl">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h4 className="text-lg font-semibold text-gray-900">Attach Questions from Bank</h4>
                <p className="text-xs text-gray-500 mt-0.5">Select questions to add into this draft paper.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowBankPicker(false)
                  setSelectedBankIds([])
                }}
                className="text-gray-500 hover:text-gray-700 text-sm"
              >
                Close
              </button>
            </div>

            <div className="px-4 py-3 border-b border-gray-100 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="text"
                value={bankSearch}
                onChange={(e) => setBankSearch(e.target.value)}
                placeholder="Search questions"
                className="input w-full"
              />
              <select value={bankType} onChange={(e) => setBankType(e.target.value)} className="input w-full">
                <option value="">All Types</option>
                {questionTypes.map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
              <select value={bankDifficulty} onChange={(e) => setBankDifficulty(e.target.value)} className="input w-full">
                <option value="">All Difficulty</option>
                <option value="EASY">Easy</option>
                <option value="MEDIUM">Medium</option>
                <option value="HARD">Hard</option>
              </select>
            </div>

            <div className="overflow-y-auto max-h-[50vh] p-4 space-y-2">
              {!classId || !subjectId ? (
                <div className="text-sm text-gray-500">Select class and subject in paper metadata to load the bank.</div>
              ) : bankLoading ? (
                <div className="text-sm text-gray-500">Loading questions...</div>
              ) : bankQuestions.length === 0 ? (
                <div className="text-sm text-gray-500">No questions found for these filters.</div>
              ) : (
                bankQuestions.map((question) => {
                  const checked = selectedBankIds.includes(Number(question.id))
                  const useCount = getQuestionReuseCount(question)
                  const isOverused = useCount >= 3
                  return (
                    <label
                      key={question.id}
                      className={`block border rounded-lg p-3 cursor-pointer ${checked ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleBankQuestion(question.id)}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                            <span className="font-medium">{question.question_type}</span>
                            <span>•</span>
                            <span>{question.difficulty_level || 'MEDIUM'}</span>
                            <span>•</span>
                            <span>{question.marks} mark(s)</span>
                            {isOverused && (
                              <>
                                <span>•</span>
                                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                                  Used in {useCount} papers
                                </span>
                              </>
                            )}
                          </div>
                          <div className="text-sm text-gray-800 line-clamp-3" dangerouslySetInnerHTML={{ __html: question.question_text }} />
                        </div>
                      </div>
                    </label>
                  )
                })
              )}
            </div>

            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between gap-2">
              <p className="text-xs text-gray-500">{selectedBankIds.length} selected</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowBankPicker(false)
                    setSelectedBankIds([])
                  }}
                  className="px-3 py-1.5 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={attachSelectedBankQuestions}
                  disabled={selectedBankIds.length === 0}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Attach Selected
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Submit */}
      {!readOnly && questions.length > 0 && (
        <div className="flex gap-2 justify-end pt-4 border-t border-gray-200">
          <div className={`mr-auto text-sm ${saveState === 'error' ? 'text-red-600' : 'text-gray-600'}`}>
            {saveStateLabel}
          </div>
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
            {isLoading ? 'Saving...' : draftReady ? 'Open Draft' : 'Create Draft'}
          </button>
        </div>
      )}
    </div>
  )
}
