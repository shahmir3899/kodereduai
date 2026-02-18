import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { examinationsApi, sessionsApi } from '../../services/api'
import ClassSelector from '../../components/ClassSelector'
import { useAcademicYear } from '../../contexts/AcademicYearContext'

export default function ResultsPage() {
  const { activeAcademicYear } = useAcademicYear()
  const [selectedExamId, setSelectedExamId] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const [classFilter, setClassFilter] = useState('')

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

  const years = yearsRes?.data?.results || yearsRes?.data || []
  const exams = examsRes?.data?.results || examsRes?.data || []
  const results = resultsRes?.data?.results || resultsRes?.data || []
  const summary = summaryRes?.data || null

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
                    {results.map((r, idx) => (
                      <tr key={idx} className={`hover:bg-gray-50 ${r.is_pass === false ? 'bg-red-50/30' : ''}`}>
                        <td className="px-3 py-2 text-center">
                          {idx < 3 ? (
                            <span className={`inline-flex w-6 h-6 items-center justify-center rounded-full text-xs font-bold text-white ${
                              idx === 0 ? 'bg-yellow-500' : idx === 1 ? 'bg-gray-400' : 'bg-amber-600'
                            }`}>{idx + 1}</span>
                          ) : (
                            <span className="text-sm text-gray-500">{idx + 1}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-sm font-medium text-gray-900">{r.student_name}</td>
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
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile */}
              <div className="md:hidden space-y-2">
                {results.map((r, idx) => (
                  <div key={idx} className={`card ${r.is_pass === false ? 'border-red-200 bg-red-50/30' : ''}`}>
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
                          <p className="font-medium text-gray-900 text-sm">{r.student_name}</p>
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
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
