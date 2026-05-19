import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Toast from '../../components/Toast'
import { questionPaperApi, studentsApi } from '../../services/api'
import { useAcademicYear } from '../../contexts/AcademicYearContext'

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeResults(payload) {
  if (Array.isArray(payload?.results)) return payload.results
  if (Array.isArray(payload)) return payload
  return []
}

function buildResponseMap(rows) {
  return rows.reduce((acc, item) => {
    const questionId = Number(item?.question)
    if (!Number.isFinite(questionId)) return acc

    acc[questionId] = {
      response_text: item?.response_text || '',
      marks_awarded: item?.marks_awarded ?? '',
      is_correct: typeof item?.is_correct === 'boolean' ? item.is_correct : null,
    }
    return acc
  }, {})
}

export default function StudentResponsePage() {
  const navigate = useNavigate()
  const { paperId } = useParams()
  const queryClient = useQueryClient()
  const { activeAcademicYear } = useAcademicYear()
  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [responsesDraft, setResponsesDraft] = useState({})
  const [toast, setToast] = useState(null)

  const {
    data: paperRes,
    isLoading: paperLoading,
    isError: paperError,
    error: paperErrorObj,
  } = useQuery({
    queryKey: ['studentResponsesPaper', paperId],
    queryFn: () => questionPaperApi.getExamPaper(paperId),
    enabled: !!paperId,
  })

  const paper = paperRes?.data
  const paperQuestions = Array.isArray(paper?.paper_questions) ? paper.paper_questions : []

  const {
    data: studentsRes,
    isLoading: studentsLoading,
    isError: studentsError,
    error: studentsErrorObj,
  } = useQuery({
    queryKey: ['studentResponsesStudents', paper?.class_obj, activeAcademicYear?.id],
    queryFn: () => studentsApi.getStudents({
      class_obj: paper?.class_obj,
      academic_year: activeAcademicYear?.id,
      page_size: 500,
    }),
    enabled: !!paper?.class_obj,
  })

  const students = normalizeResults(studentsRes?.data)

  useEffect(() => {
    if (!selectedStudentId && students.length > 0) {
      setSelectedStudentId(String(students[0].id))
    }
  }, [selectedStudentId, students])

  const {
    data: studentResponsesRes,
    isLoading: studentResponsesLoading,
    isError: studentResponsesError,
    error: studentResponsesErrorObj,
  } = useQuery({
    queryKey: ['studentResponsesByStudent', paperId, selectedStudentId],
    queryFn: () => questionPaperApi.getStudentResponses({
      exam_paper: paperId,
      student: selectedStudentId,
      page_size: 500,
    }),
    enabled: !!paperId && !!selectedStudentId,
  })

  const {
    data: allResponsesRes,
    isLoading: allResponsesLoading,
    isError: allResponsesError,
  } = useQuery({
    queryKey: ['studentResponsesProgress', paperId],
    queryFn: () => questionPaperApi.getStudentResponses({ exam_paper: paperId, page_size: 2000 }),
    enabled: !!paperId,
  })

  const savedRows = normalizeResults(studentResponsesRes?.data)
  const savedResponseMap = useMemo(() => buildResponseMap(savedRows), [savedRows])

  useEffect(() => {
    setResponsesDraft(savedResponseMap)
  }, [savedResponseMap, selectedStudentId])

  const completion = useMemo(() => {
    const rows = normalizeResults(allResponsesRes?.data)
    const uniqueStudents = new Set(rows.map((entry) => Number(entry?.student)).filter((id) => Number.isFinite(id)))
    return {
      enteredCount: uniqueStudents.size,
      totalStudents: students.length,
    }
  }, [allResponsesRes?.data, students.length])

  const updateResponseDraft = (questionId, updates) => {
    setResponsesDraft((prev) => ({
      ...prev,
      [questionId]: {
        response_text: prev[questionId]?.response_text || '',
        marks_awarded: prev[questionId]?.marks_awarded ?? '',
        is_correct: prev[questionId]?.is_correct ?? null,
        ...updates,
      },
    }))
  }

  const submitMutation = useMutation({
    mutationFn: (payload) => questionPaperApi.submitStudentResponses(payload),
    onSuccess: (response) => {
      const payload = response?.data || {}
      setToast({
        type: 'success',
        message: `Saved responses: ${payload.created_count || 0} created, ${payload.updated_count || 0} updated.`,
      })
      queryClient.invalidateQueries({ queryKey: ['studentResponsesByStudent', paperId, selectedStudentId] })
      queryClient.invalidateQueries({ queryKey: ['studentResponsesProgress', paperId] })
      queryClient.invalidateQueries({ queryKey: ['examPapersList'] })
    },
    onError: (error) => {
      const msg = error?.response?.data?.detail || 'Failed to save responses.'
      setToast({ type: 'error', message: msg })
    },
  })

  const handleSubmit = () => {
    if (!selectedStudentId) {
      setToast({ type: 'error', message: 'Select a student first.' })
      return
    }

    const rows = paperQuestions
      .map((paperQuestion) => {
        const questionId = Number(paperQuestion?.question)
        const draft = responsesDraft[questionId]
        if (!Number.isFinite(questionId) || !draft) return null

        const marksRaw = draft.marks_awarded
        const marksValue = marksRaw === '' || marksRaw === null || marksRaw === undefined
          ? null
          : Number(marksRaw)

        if (
          (draft.response_text || '').trim() === ''
          && marksValue === null
          && typeof draft.is_correct !== 'boolean'
        ) {
          return null
        }

        return {
          question: questionId,
          response_text: draft.response_text || '',
          marks_awarded: marksValue,
          is_correct: typeof draft.is_correct === 'boolean' ? draft.is_correct : null,
        }
      })
      .filter(Boolean)

    if (rows.length === 0) {
      setToast({ type: 'error', message: 'Enter at least one response before submitting.' })
      return
    }

    submitMutation.mutate({
      exam_paper: Number(paperId),
      student: Number(selectedStudentId),
      responses: rows,
    })
  }

  if (paperLoading) {
    return <div className="min-h-screen bg-gray-50 p-6 text-sm text-gray-500">Loading exam paper...</div>
  }

  if (paperError) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 text-sm text-red-600">
        {paperErrorObj?.response?.data?.detail || 'Failed to load exam paper.'}
      </div>
    )
  }

  if (!paper) {
    return <div className="min-h-screen bg-gray-50 p-6 text-sm text-gray-500">Exam paper not found.</div>
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Student Response Entry</h1>
            <p className="text-sm text-gray-500 mt-1">{paper.paper_title} - {paper.subject_name}</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/academics/papers')}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100"
          >
            Back to Papers
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6 space-y-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <p className="text-xs text-gray-500">Class</p>
            <p className="text-sm font-medium text-gray-800">{paper.class_name || 'N/A'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Questions</p>
            <p className="text-sm font-medium text-gray-800">{paperQuestions.length}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Progress</p>
            {allResponsesLoading ? (
              <p className="text-sm text-gray-500">Loading progress...</p>
            ) : allResponsesError ? (
              <p className="text-sm text-red-600">Unable to load progress.</p>
            ) : (
              <p className="text-sm font-medium text-gray-800">
                {completion.enteredCount} of {completion.totalStudents} students entered
              </p>
            )}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
          <label className="block text-sm font-medium text-gray-700">Student</label>

          {studentsLoading ? (
            <p className="text-sm text-gray-500">Loading students...</p>
          ) : studentsError ? (
            <p className="text-sm text-red-600">{studentsErrorObj?.response?.data?.detail || 'Failed to load students.'}</p>
          ) : students.length === 0 ? (
            <p className="text-sm text-gray-500">No students found for this class.</p>
          ) : (
            <select
              value={selectedStudentId}
              onChange={(e) => setSelectedStudentId(e.target.value)}
              className="input w-full md:w-96"
            >
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name} {student.roll_number ? `(${student.roll_number})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {paperQuestions.length === 0 ? (
            <div className="p-6 text-sm text-gray-500">No questions found in this paper yet.</div>
          ) : !selectedStudentId ? (
            <div className="p-6 text-sm text-gray-500">Select a student to start entering responses.</div>
          ) : studentResponsesLoading ? (
            <div className="p-6 text-sm text-gray-500">Loading existing responses...</div>
          ) : studentResponsesError ? (
            <div className="p-6 text-sm text-red-600">{studentResponsesErrorObj?.response?.data?.detail || 'Failed to load student responses.'}</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {paperQuestions.map((paperQuestion, index) => {
                const questionId = Number(paperQuestion.question)
                const maxMarks = Number(paperQuestion.marks ?? paperQuestion.marks_override ?? 0) || 0
                const response = responsesDraft[questionId] || {
                  response_text: '',
                  marks_awarded: '',
                  is_correct: null,
                }
                const isMcq = String(paperQuestion.question_type || '').toUpperCase() === 'MCQ'

                return (
                  <div key={paperQuestion.id || `${questionId}_${index}`} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">Q{index + 1} ({paperQuestion.question_type})</p>
                        <p className="text-xs text-gray-500">Max marks: {maxMarks}</p>
                      </div>
                    </div>

                    <p className="text-sm text-gray-700">{stripHtml(paperQuestion.question_text)}</p>

                    {isMcq && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                        {['A', 'B', 'C', 'D'].map((option) => {
                          const value = paperQuestion[`option_${option.toLowerCase()}`]
                          if (!value) return null
                          const isCorrectOption = String(paperQuestion.correct_answer || '').toUpperCase() === option
                          return (
                            <div
                              key={`${paperQuestion.id}_${option}`}
                              className={`rounded border px-3 py-2 ${isCorrectOption ? 'border-green-300 bg-green-50 text-green-800' : 'border-gray-200 text-gray-700'}`}
                            >
                              {option}. {value}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {isMcq ? (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-gray-600">Mark as</p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => updateResponseDraft(questionId, { is_correct: true, marks_awarded: maxMarks })}
                              className={`px-3 py-1.5 text-xs rounded border ${response.is_correct === true ? 'border-green-300 bg-green-100 text-green-800' : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`}
                            >
                              Correct
                            </button>
                            <button
                              type="button"
                              onClick={() => updateResponseDraft(questionId, { is_correct: false, marks_awarded: 0 })}
                              className={`px-3 py-1.5 text-xs rounded border ${response.is_correct === false ? 'border-red-300 bg-red-100 text-red-800' : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`}
                            >
                              Incorrect
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-gray-600">Marks Awarded</label>
                          <input
                            type="number"
                            min="0"
                            max={maxMarks}
                            step="0.5"
                            value={response.marks_awarded}
                            onChange={(e) => {
                              const raw = e.target.value
                              const numeric = raw === '' ? '' : Math.min(maxMarks, Math.max(0, Number(raw)))
                              updateResponseDraft(questionId, { marks_awarded: numeric })
                            }}
                            className="input w-full"
                          />
                        </div>
                      )}

                      <div className="md:col-span-2 space-y-1">
                        <label className="text-xs font-medium text-gray-600">Student Response</label>
                        <textarea
                          rows={2}
                          value={response.response_text}
                          onChange={(e) => updateResponseDraft(questionId, { response_text: e.target.value })}
                          placeholder="Optional: add student response text"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitMutation.isPending || !selectedStudentId || paperQuestions.length === 0}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitMutation.isPending ? 'Saving...' : 'Submit Responses'}
          </button>
        </div>
      </div>
    </div>
  )
}
