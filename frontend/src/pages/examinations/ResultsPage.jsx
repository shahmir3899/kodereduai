import React, { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { examinationsApi, sessionsApi } from '../../services/api'
import ClassSelector from '../../components/ClassSelector'
import { useAcademicYear } from '../../contexts/AcademicYearContext'

export default function ResultsPage() {
  const queryClient = useQueryClient()
  const { activeAcademicYear } = useAcademicYear()
  const [selectedExamId, setSelectedExamId] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const [classFilter, setClassFilter] = useState('')
  const [expandedStudent, setExpandedStudent] = useState(null)
  const [commentMsg, setCommentMsg] = useState('')

  // Sync year filter with global session switcher
  useEffect(() => {
    if (activeAcademicYear?.id) {
      setYearFilter(String(activeAcademicYear.id))
    }
  }, [activeAcademicYear?.id])

  // Queries
  const { data: yearsRes } = useQuery({
    queryKey: ['academicYears'],
    queryFn: () => sessionsApi.getAcademicYears({ page_size: 9999 }),
  })

  const { data: examsRes } = useQuery({
    queryKey: ['exams', yearFilter, classFilter],
    queryFn: () => examinationsApi.getExams({
      academic_year: yearFilter || undefined,
      class_obj: classFilter || undefined,
    }),
  })

  const { data: resultsRes, isLoading: resultsLoading } = useQuery({
    queryKey: ['examResults', selectedExamId],
    queryFn: () => examinationsApi.getExamResults(selectedExamId),
    enabled: !!selectedExamId,
  })

  const { data: summaryRes } = useQuery({
    queryKey: ['classSummary', selectedExamId],
    queryFn: () => examinationsApi.getClassSummary(selectedExamId),
    enabled: !!selectedExamId,
  })

  // AI comment generation
  const generateCommentsMut = useMutation({
    mutationFn: ({ examId, force }) => examinationsApi.generateComments(examId, force),
    onSuccess: (res) => {
      const d = res.data
      setCommentMsg(`Generated ${d.generated} comments (${d.skipped} skipped, ${d.errors} errors).`)
      queryClient.invalidateQueries(['examResults', selectedExamId])
    },
    onError: () => setCommentMsg('Failed to generate comments.'),
  })

  const years = yearsRes?.data?.results || yearsRes?.data || []
  const exams = examsRes?.data?.results || examsRes?.data || []
  const results = resultsRes?.data?.results || resultsRes?.data || []
  const summary = summaryRes?.data || null
  const hasAnyComments = results?.results?.some(r => r.marks?.some(m => m.ai_comment)) ||
    results?.some?.(r => r.marks?.some(m => m.ai_comment))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Exam Results</h1>
        <p className="text-sm text-gray-600">View ranked results with pass/fail analysis</p>
      </div>

      {/* Selection */}
      <div className="card mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Academic Year</label>
            <select value={yearFilter} onChange={e => { setYearFilter(e.target.value); setSelectedExamId('') }} className="input w-full text-sm">
              <option value="">All Years</option>
              {years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Class</label>
            <ClassSelector value={classFilter} onChange={e => { setClassFilter(e.target.value); setSelectedExamId('') }} className="input w-full text-sm" showAllOption />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Exam</label>
            <select value={selectedExamId} onChange={e => setSelectedExamId(e.target.value)} className="input w-full text-sm">
              <option value="">Select exam...</option>
              {exams.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* AI Comment Generation */}
      {selectedExamId && (
        <div className="card mb-4 bg-indigo-50/50 border border-indigo-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-indigo-900">AI Report Card Comments</h3>
              <p className="text-xs text-indigo-700 mt-0.5">
                Uses AI to generate personalized 2-3 sentence comments for each student's marks based on their score, grade, and attendance record. Comments can be viewed by expanding student rows.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => { setCommentMsg(''); generateCommentsMut.mutate({ examId: selectedExamId, force: false }) }}
                disabled={generateCommentsMut.isPending}
                className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
              >
                {generateCommentsMut.isPending ? 'Generating...' : 'Generate Comments'}
              </button>
              <button
                onClick={() => { setCommentMsg(''); generateCommentsMut.mutate({ examId: selectedExamId, force: true }) }}
                disabled={generateCommentsMut.isPending}
                className="px-3 py-1.5 text-xs text-indigo-700 border border-indigo-300 rounded-lg hover:bg-indigo-100 disabled:opacity-50 whitespace-nowrap"
                title="Regenerate all comments, including previously generated ones"
              >
                Regenerate All
              </button>
            </div>
          </div>
          {commentMsg && (
            <p className="mt-2 text-xs text-indigo-800 bg-indigo-100 rounded px-2 py-1">{commentMsg}</p>
          )}
        </div>
      )}

      {!selectedExamId ? (
        <div className="card text-center py-12 text-gray-400">
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Select an exam above to view results
        </div>
      ) : resultsLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="card text-center">
                <p className="text-2xl font-bold text-gray-900">{summary.total_students || 0}</p>
                <p className="text-xs text-gray-500">Total Students</p>
              </div>
              <div className="card text-center">
                <p className="text-2xl font-bold text-green-600">{summary.pass_count || 0}</p>
                <p className="text-xs text-gray-500">Passed</p>
              </div>
              <div className="card text-center">
                <p className="text-2xl font-bold text-red-600">{summary.fail_count || 0}</p>
                <p className="text-xs text-gray-500">Failed</p>
              </div>
              <div className="card text-center">
                <p className="text-2xl font-bold text-blue-600">{summary.class_average ? `${Number(summary.class_average).toFixed(1)}%` : '—'}</p>
                <p className="text-xs text-gray-500">Class Average</p>
              </div>
            </div>
          )}

          {/* Topper & Subject stats */}
          {summary?.topper && (
            <div className="card mb-4 bg-yellow-50/50 border border-yellow-200">
              <div className="flex items-center gap-2">
                <span className="text-yellow-600 text-lg">&#9733;</span>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    Class Topper: <strong>{summary.topper.student_name}</strong>
                  </p>
                  <p className="text-xs text-gray-600">
                    Total: {summary.topper.total_marks} | Percentage: {Number(summary.topper.percentage).toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Results Table */}
          {results.length === 0 ? (
            <div className="card text-center py-8 text-gray-500">No results data available for this exam.</div>
          ) : (
            <>
              {/* Desktop */}
              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-full bg-white rounded-xl shadow-sm border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <th className="px-3 py-3 text-center w-12">Rank</th>
                      <th className="px-3 py-3 text-left">Student</th>
                      <th className="px-3 py-3 text-left">Roll No</th>
                      <th className="px-3 py-3 text-center">Marks</th>
                      <th className="px-3 py-3 text-center">Total</th>
                      <th className="px-3 py-3 text-center">%</th>
                      <th className="px-3 py-3 text-center">Grade</th>
                      <th className="px-3 py-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {results.map((r, idx) => {
                      const hasComments = r.marks?.some(m => m.ai_comment)
                      const isExpanded = expandedStudent === r.student_id
                      return (
                        <React.Fragment key={idx}>
                          <tr
                            className={`hover:bg-gray-50 ${r.is_pass === false ? 'bg-red-50/30' : ''} ${hasComments ? 'cursor-pointer' : ''}`}
                            onClick={() => hasComments && setExpandedStudent(isExpanded ? null : r.student_id)}
                          >
                            <td className="px-3 py-2 text-center">
                              {idx < 3 ? (
                                <span className={`inline-flex w-6 h-6 items-center justify-center rounded-full text-xs font-bold text-white ${
                                  idx === 0 ? 'bg-yellow-500' : idx === 1 ? 'bg-gray-400' : 'bg-amber-600'
                                }`}>{idx + 1}</span>
                              ) : (
                                <span className="text-sm text-gray-500">{idx + 1}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-sm font-medium text-gray-900">
                              {r.student_name}
                              {hasComments && (
                                <span className="ml-1 text-indigo-400 text-[10px]">{isExpanded ? '▲' : '▼'}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-sm font-mono text-gray-600">{r.roll_number}</td>
                            <td className="px-3 py-2 text-sm text-center font-medium">{r.obtained_marks ?? '—'}</td>
                            <td className="px-3 py-2 text-sm text-center text-gray-500">{r.total_marks ?? '—'}</td>
                            <td className="px-3 py-2 text-sm text-center font-medium">
                              {r.percentage != null ? `${Number(r.percentage).toFixed(1)}%` : '—'}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {r.grade ? (
                                <span className="px-2 py-0.5 bg-primary-100 text-primary-700 rounded text-xs font-medium">{r.grade}</span>
                              ) : '—'}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {r.is_pass === true ? (
                                <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs">Pass</span>
                              ) : r.is_pass === false ? (
                                <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs">Fail</span>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={8} className="bg-indigo-50/50 px-6 py-3">
                                <p className="text-[10px] font-medium text-indigo-600 uppercase mb-1.5">AI Comments</p>
                                <div className="space-y-1.5">
                                  {r.marks?.filter(m => m.ai_comment).map((m, mi) => (
                                    <div key={mi} className="flex gap-2">
                                      <span className="text-xs font-medium text-gray-700 min-w-[80px]">{m.subject_name}:</span>
                                      <span className="text-xs text-gray-600 italic">{m.ai_comment}</span>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile */}
              <div className="md:hidden space-y-2">
                {results.map((r, idx) => {
                  const hasComments = r.marks?.some(m => m.ai_comment)
                  const isExpanded = expandedStudent === r.student_id
                  return (
                    <div
                      key={idx}
                      className={`card ${r.is_pass === false ? 'border-red-200 bg-red-50/30' : ''} ${hasComments ? 'cursor-pointer' : ''}`}
                      onClick={() => hasComments && setExpandedStudent(isExpanded ? null : r.student_id)}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          {idx < 3 ? (
                            <span className={`inline-flex w-6 h-6 items-center justify-center rounded-full text-xs font-bold text-white ${
                              idx === 0 ? 'bg-yellow-500' : idx === 1 ? 'bg-gray-400' : 'bg-amber-600'
                            }`}>{idx + 1}</span>
                          ) : (
                            <span className="text-sm text-gray-400">#{idx + 1}</span>
                          )}
                          <div>
                            <p className="font-medium text-gray-900 text-sm">
                              {r.student_name}
                              {hasComments && <span className="ml-1 text-indigo-400 text-[10px]">{isExpanded ? '▲' : '▼'}</span>}
                            </p>
                            <p className="text-xs text-gray-500">Roll: {r.roll_number}</p>
                          </div>
                        </div>
                        {r.is_pass === true ? (
                          <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs">Pass</span>
                        ) : r.is_pass === false ? (
                          <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs">Fail</span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-600">
                        <span>Marks: {r.obtained_marks ?? '—'}/{r.total_marks ?? '—'}</span>
                        <span>{r.percentage != null ? `${Number(r.percentage).toFixed(1)}%` : ''}</span>
                        {r.grade && <span className="px-1.5 py-0.5 bg-primary-100 text-primary-700 rounded text-xs">{r.grade}</span>}
                      </div>
                      {isExpanded && (
                        <div className="mt-2 pt-2 border-t border-indigo-100">
                          <p className="text-[10px] font-medium text-indigo-600 uppercase mb-1">AI Comments</p>
                          <div className="space-y-1">
                            {r.marks?.filter(m => m.ai_comment).map((m, mi) => (
                              <p key={mi} className="text-xs text-gray-600">
                                <span className="font-medium text-gray-700">{m.subject_name}:</span>{' '}
                                <span className="italic">{m.ai_comment}</span>
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
