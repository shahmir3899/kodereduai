import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { parentsApi } from '../../services/api'

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

export default function ChildExamResults() {
  const { studentId } = useParams()

  const { data: examData, isLoading } = useQuery({
    queryKey: ['childExamResults', studentId],
    queryFn: () => parentsApi.getChildExamResults(studentId),
    enabled: !!studentId,
  })

  const results = examData?.data
  const exams = results?.exams || (Array.isArray(results) ? results : [])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Link to={`/parent/children/${studentId}`} className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Overview
        </Link>
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link to={`/parent/children/${studentId}`} className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Overview
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Exam Results</h1>
        <p className="text-sm text-gray-500 mt-1">Subject-wise marks and grades</p>
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
        <div className="space-y-6">
          {exams.map((exam, examIdx) => {
            const marks = exam.marks || exam.subjects || []
            const totalObtained = marks.reduce((sum, m) => sum + (parseFloat(m.marks_obtained) || 0), 0)
            const totalMax = marks.reduce((sum, m) => sum + (parseFloat(m.total_marks) || 0), 0)
            const overallPct = totalMax > 0 ? Math.round((totalObtained / totalMax) * 100) : 0

            return (
              <div key={examIdx} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Exam Header */}
                <div className="px-5 py-4 bg-gray-50 border-b border-gray-200">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">
                        {exam.exam_name || exam.name || `Exam ${examIdx + 1}`}
                      </h2>
                      {exam.exam_date && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          {new Date(exam.exam_date).toLocaleDateString('en-US', {
                            month: 'long', year: 'numeric'
                          })}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-xs text-gray-500">Total</p>
                        <p className="text-sm font-bold text-gray-900">{totalObtained} / {totalMax}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">Percentage</p>
                        <p className={`text-sm font-bold ${gradeColor(overallPct)}`}>{overallPct}%</p>
                      </div>
                      {exam.rank && (
                        <div className="text-right">
                          <p className="text-xs text-gray-500">Rank</p>
                          <p className="text-sm font-bold text-primary-700">#{exam.rank}</p>
                        </div>
                      )}
                      {exam.grade && (
                        <div className="px-3 py-1 rounded-lg bg-primary-100 border border-primary-200">
                          <p className="text-xs text-primary-600">Grade</p>
                          <p className="text-sm font-bold text-primary-800">{exam.grade}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Subject Marks - Mobile Card View */}
                <div className="sm:hidden divide-y divide-gray-100">
                  {marks.map((m, idx) => {
                    const pct = m.total_marks ? Math.round((m.marks_obtained / m.total_marks) * 100) : 0
                    return (
                      <div key={idx} className="px-4 py-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-gray-900">
                            {m.subject_name || m.subject}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-600">
                              {m.marks_obtained}/{m.total_marks}
                            </span>
                            <span className={`text-sm font-semibold ${gradeColor(pct)}`}>{pct}%</span>
                          </div>
                        </div>
                        {/* Progress bar */}
                        <div className={`w-full h-2 rounded-full ${barBgColor(pct)}`}>
                          <div
                            className={`h-2 rounded-full transition-all ${barColor(pct)}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        {m.grade && (
                          <p className="text-xs text-gray-500 mt-1">Grade: {m.grade}</p>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Subject Marks - Desktop Table View */}
                <div className="hidden sm:block">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead>
                      <tr className="bg-white">
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Subject</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Obtained</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase w-48">Progress</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Percentage</th>
                        <th className="px-4 py-2.5 text-center text-xs font-medium text-gray-500 uppercase">Grade</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {marks.map((m, idx) => {
                        const pct = m.total_marks ? Math.round((m.marks_obtained / m.total_marks) * 100) : 0
                        return (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">
                              {m.subject_name || m.subject}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right">{m.marks_obtained}</td>
                            <td className="px-4 py-3 text-sm text-gray-500 text-right">{m.total_marks}</td>
                            <td className="px-4 py-3">
                              <div className={`w-full h-2.5 rounded-full ${barBgColor(pct)}`}>
                                <div
                                  className={`h-2.5 rounded-full transition-all ${barColor(pct)}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className={`text-sm font-semibold ${gradeColor(pct)}`}>{pct}%</span>
                            </td>
                            <td className="px-4 py-3 text-center text-sm text-gray-600 font-medium">
                              {m.grade || '-'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    {/* Footer totals */}
                    <tfoot>
                      <tr className="bg-gray-50 border-t-2 border-gray-200">
                        <td className="px-4 py-3 text-sm font-semibold text-gray-900">Total</td>
                        <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right">{totalObtained}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-gray-500 text-right">{totalMax}</td>
                        <td className="px-4 py-3">
                          <div className={`w-full h-2.5 rounded-full ${barBgColor(overallPct)}`}>
                            <div
                              className={`h-2.5 rounded-full transition-all ${barColor(overallPct)}`}
                              style={{ width: `${overallPct}%` }}
                            />
                          </div>
                        </td>
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
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
