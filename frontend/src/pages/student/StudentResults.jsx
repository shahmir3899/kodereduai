import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { studentPortalApi } from '../../services/api'

function gradeColor(pct) {
  if (pct >= 80) return 'text-green-700'
  if (pct >= 60) return 'text-blue-700'
  if (pct >= 40) return 'text-yellow-700'
  return 'text-red-700'
}

function barColor(pct) {
  if (pct >= 80) return 'bg-green-500'
  if (pct >= 60) return 'bg-blue-500'
  if (pct >= 40) return 'bg-yellow-500'
  return 'bg-red-500'
}

function barBgColor(pct) {
  if (pct >= 80) return 'bg-green-100'
  if (pct >= 60) return 'bg-blue-100'
  if (pct >= 40) return 'bg-yellow-100'
  return 'bg-red-100'
}

function statusBadge(pct, isAbsent) {
  if (isAbsent) return { label: 'Absent', cls: 'bg-gray-100 text-gray-800' }
  if (pct >= 40) return { label: 'Pass', cls: 'bg-green-100 text-green-800' }
  return { label: 'Fail', cls: 'bg-red-100 text-red-800' }
}

export default function StudentResults() {
  const [expandedExam, setExpandedExam] = useState(null)

  const { data: examData, isLoading, error } = useQuery({
    queryKey: ['studentExamResults'],
    queryFn: () => studentPortalApi.getExamResults(),
  })

  const results = examData?.data
  const exams = results?.exams || (Array.isArray(results) ? results : [])

  const toggleExam = (idx) => {
    setExpandedExam(expandedExam === idx ? null : idx)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <h3 className="text-base font-medium text-red-900 mb-1">Failed to load exam results</h3>
        <p className="text-sm text-red-600">{error.message || 'Please try again later.'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">My Results</h1>
        <p className="text-sm text-gray-500 mt-1">Subject-wise exam marks and performance</p>
      </div>

      {exams.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <svg className="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
          </svg>
          <h3 className="text-base font-medium text-gray-900 mb-1">No exam results yet</h3>
          <p className="text-sm text-gray-500">Results will appear here once exams are conducted and marks are published.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {exams.map((exam, examIdx) => {
            const marks = exam.marks || exam.subjects || []
            const totalObtained = marks.reduce((sum, m) => sum + (parseFloat(m.marks_obtained) || 0), 0)
            const totalMax = marks.reduce((sum, m) => sum + (parseFloat(m.total_marks) || 0), 0)
            const overallPct = totalMax > 0 ? Math.round((totalObtained / totalMax) * 100) : 0
            const isExpanded = expandedExam === null || expandedExam === examIdx

            return (
              <div key={examIdx} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Exam Header - Collapsible */}
                <button
                  onClick={() => toggleExam(examIdx)}
                  className="w-full px-5 py-4 bg-gray-50 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 hover:bg-gray-100 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <svg
                      className={`w-5 h-5 text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">
                        {exam.exam_name || exam.name || `Exam ${examIdx + 1}`}
                      </h2>
                      <div className="flex items-center gap-2 mt-0.5">
                        {exam.exam_type && (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                            {exam.exam_type}
                          </span>
                        )}
                        {exam.exam_date && (
                          <span className="text-xs text-gray-500">
                            {new Date(exam.exam_date).toLocaleDateString('en-US', {
                              month: 'long', year: 'numeric'
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 ml-8 sm:ml-0">
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Total</p>
                      <p className="text-sm font-bold text-gray-900">{totalObtained} / {totalMax}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Percentage</p>
                      <p className={`text-sm font-bold ${gradeColor(overallPct)}`}>{overallPct}%</p>
                    </div>
                    {exam.grade && (
                      <div className="px-3 py-1 rounded-lg bg-blue-100 border border-blue-200">
                        <p className="text-xs text-blue-600">Grade</p>
                        <p className="text-sm font-bold text-blue-800">{exam.grade}</p>
                      </div>
                    )}
                  </div>
                </button>

                {/* Subject Marks - Collapsible Content */}
                {isExpanded && (
                  <>
                    {/* Mobile Card View */}
                    <div className="sm:hidden divide-y divide-gray-100">
                      {marks.map((m, idx) => {
                        const pct = m.total_marks ? Math.round((m.marks_obtained / m.total_marks) * 100) : 0
                        const isAbsent = m.status === 'ABSENT' || m.is_absent
                        const badge = statusBadge(pct, isAbsent)
                        return (
                          <div key={idx} className="px-4 py-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium text-gray-900">
                                {m.subject_name || m.subject}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.cls}`}>
                                  {badge.label}
                                </span>
                                <span className={`text-sm font-semibold ${gradeColor(pct)}`}>{pct}%</span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                              <span>{m.marks_obtained}/{m.total_marks}</span>
                            </div>
                            <div className={`w-full h-2 rounded-full ${barBgColor(pct)}`}>
                              <div
                                className={`h-2 rounded-full transition-all ${barColor(pct)}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Desktop Table View */}
                    <div className="hidden sm:block">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead>
                          <tr className="bg-white">
                            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Subject</th>
                            <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Marks Obtained</th>
                            <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Total Marks</th>
                            <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Percentage</th>
                            <th className="px-4 py-2.5 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {marks.map((m, idx) => {
                            const pct = m.total_marks ? Math.round((m.marks_obtained / m.total_marks) * 100) : 0
                            const isAbsent = m.status === 'ABSENT' || m.is_absent
                            const badge = statusBadge(pct, isAbsent)
                            return (
                              <tr key={idx} className="hover:bg-gray-50">
                                <td className="px-4 py-3 text-sm font-medium text-gray-900">
                                  {m.subject_name || m.subject}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-900 text-right">{m.marks_obtained}</td>
                                <td className="px-4 py-3 text-sm text-gray-500 text-right">{m.total_marks}</td>
                                <td className="px-4 py-3 text-right">
                                  <span className={`text-sm font-semibold ${gradeColor(pct)}`}>{pct}%</span>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.cls}`}>
                                    {badge.label}
                                  </span>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        {/* Summary Footer */}
                        <tfoot>
                          <tr className="bg-gray-50 border-t-2 border-gray-200">
                            <td className="px-4 py-3 text-sm font-semibold text-gray-900">Total</td>
                            <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right">{totalObtained}</td>
                            <td className="px-4 py-3 text-sm font-semibold text-gray-500 text-right">{totalMax}</td>
                            <td className="px-4 py-3 text-right">
                              <span className={`text-sm font-bold ${gradeColor(overallPct)}`}>{overallPct}%</span>
                            </td>
                            <td className="px-4 py-3 text-center text-sm font-semibold text-gray-600">
                              {exam.grade || '-'}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
