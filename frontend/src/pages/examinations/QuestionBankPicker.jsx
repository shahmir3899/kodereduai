import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { questionPaperApi } from '../../services/api'

export const QUESTION_TYPES = [
  { value: 'MCQ', label: 'Multiple Choice' },
  { value: 'SHORT', label: 'Short Answer' },
  { value: 'LONG', label: 'Long Answer' },
  { value: 'ESSAY', label: 'Essay' },
  { value: 'TRUE_FALSE', label: 'True/False' },
  { value: 'MATCHING', label: 'Matching' },
  { value: 'FILL_BLANK', label: 'Fill in the Blanks' },
]

export function getQuestionReuseCount(question, overusedQuestionCounts = {}) {
  const directCount = Number(question?.paper_use_count)
  if (Number.isFinite(directCount)) return directCount

  const questionId = Number(question?.id ?? question?.question_id)
  if (!Number.isFinite(questionId)) return 0

  const mappedCount = Number(overusedQuestionCounts?.[questionId])
  return Number.isFinite(mappedCount) ? mappedCount : 0
}

/** Converts a question-bank record into a draft-question shape compatible with toQuestionDraft. */
export function toDraftQuestionFromBank(question, overrides = {}) {
  return {
    local_id: `bank_${question.id}_${Date.now()}_${Math.random()}`,
    question_id: question.id,
    section_key: '',
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
    ...overrides,
  }
}

/**
 * QuestionBankPicker - shared modal for searching and multi-selecting questions
 * from the question bank. Consumed by ManualEntryPaperTab (unassigned attach)
 * and QuestionSlotEditor's bank source (per-slot attach).
 */
export default function QuestionBankPicker({
  open,
  onClose,
  classId,
  subjectId,
  topicIds = [],
  lockedQuestionType,
  excludeQuestionIds = [],
  overusedQuestionCounts = {},
  onAttach,
}) {
  const [search, setSearch] = useState('')
  const [type, setType] = useState(lockedQuestionType || '')
  const [difficulty, setDifficulty] = useState('')
  const [selectedIds, setSelectedIds] = useState([])

  const hasTopicFilter = Array.isArray(topicIds) && topicIds.length > 0

  const queryParams = useMemo(() => ({
    ...(classId && { class_id: classId }),
    ...(subjectId && { subject: subjectId }),
    ...(search.trim() && { search: search.trim() }),
    ...((lockedQuestionType || type) && { question_type: lockedQuestionType || type }),
    ...(difficulty && { difficulty_level: difficulty }),
    page_size: 50,
  }), [classId, subjectId, search, type, lockedQuestionType, difficulty])

  const { data: bankData, isLoading: bankLoading } = useQuery({
    queryKey: ['paperBuilderQuestionBankPicker', queryParams, topicIds],
    queryFn: () => (hasTopicFilter
      ? questionPaperApi.getQuestionsByTopics(topicIds, queryParams)
      : questionPaperApi.getQuestions(queryParams)),
    enabled: open && !!classId && !!subjectId,
  })

  const excludeSet = useMemo(
    () => new Set((excludeQuestionIds || []).map((id) => Number(id))),
    [excludeQuestionIds],
  )

  const bankQuestions = useMemo(() => {
    const rows = bankData?.data?.results || bankData?.data || []
    return rows.filter((question) => !excludeSet.has(Number(question.id)))
  }, [bankData, excludeSet])

  if (!open) return null

  const toggleSelection = (questionId) => {
    const id = Number(questionId)
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
  }

  const handleClose = () => {
    setSelectedIds([])
    onClose?.()
  }

  const handleAttach = () => {
    const selectedQuestions = bankQuestions.filter((question) => selectedIds.includes(Number(question.id)))
    if (selectedQuestions.length === 0) return
    onAttach?.(selectedQuestions)
    setSelectedIds([])
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[85vh] overflow-hidden border border-gray-200 shadow-xl">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h4 className="text-lg font-semibold text-gray-900">Attach Questions from Bank</h4>
            <p className="text-xs text-gray-500 mt-0.5">Select questions to add into this draft paper.</p>
          </div>
          <button type="button" onClick={handleClose} className="text-gray-500 hover:text-gray-700 text-sm">
            Close
          </button>
        </div>

        <div className="px-4 py-3 border-b border-gray-100 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search questions"
            className="input w-full"
          />
          <select
            value={lockedQuestionType || type}
            onChange={(e) => setType(e.target.value)}
            disabled={!!lockedQuestionType}
            className="input w-full disabled:opacity-60"
          >
            <option value="">All Types</option>
            {QUESTION_TYPES.map((qType) => (
              <option key={qType.value} value={qType.value}>{qType.label}</option>
            ))}
          </select>
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="input w-full">
            <option value="">All Difficulty</option>
            <option value="EASY">Easy</option>
            <option value="MEDIUM">Medium</option>
            <option value="HARD">Hard</option>
          </select>
        </div>

        <div className="overflow-y-auto max-h-[50vh] p-4 space-y-2">
          {!classId || !subjectId ? (
            <div className="text-sm text-gray-500">Select class and subject in paper setup to load the bank.</div>
          ) : bankLoading ? (
            <div className="text-sm text-gray-500">Loading questions...</div>
          ) : bankQuestions.length === 0 ? (
            <div className="text-sm text-gray-500">No questions found for these filters.</div>
          ) : (
            bankQuestions.map((question) => {
              const checked = selectedIds.includes(Number(question.id))
              const useCount = getQuestionReuseCount(question, overusedQuestionCounts)
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
                      onChange={() => toggleSelection(question.id)}
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
          <p className="text-xs text-gray-500">{selectedIds.length} selected</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAttach}
              disabled={selectedIds.length === 0}
              className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Attach Selected
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
