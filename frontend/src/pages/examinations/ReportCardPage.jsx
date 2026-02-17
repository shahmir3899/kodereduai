import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { examinationsApi, sessionsApi, studentsApi } from '../../services/api'
import { useAcademicYear } from '../../contexts/AcademicYearContext'

export default function ReportCardPage() {
  const { activeAcademicYear } = useAcademicYear()
  const [studentId, setStudentId] = useState('')
  const [yearId, setYearId] = useState('')
  const [termId, setTermId] = useState('')
  const [search, setSearch] = useState('')

  // Sync year filter with global session switcher
  useEffect(() => {
    if (activeAcademicYear?.id) {
      setYearId(String(activeAcademicYear.id))
    }
  }, [activeAcademicYear?.id])

  // Queries
  const { data: yearsRes } = useQuery({
    queryKey: ['academicYears'],
    queryFn: () => sessionsApi.getAcademicYears({ page_size: 9999 }),
  })

  const { data: termsRes } = useQuery({
    queryKey: ['terms', yearId],
    queryFn: () => sessionsApi.getTerms({ academic_year: yearId, page_size: 9999 }),
    enabled: !!yearId,
  })

  const { data: studentsRes } = useQuery({
    queryKey: ['students', search],
    queryFn: () => studentsApi.getStudents({ search: search || undefined, page_size: 50 }),
  })

  const { data: reportRes, isLoading: reportLoading } = useQuery({
    queryKey: ['reportCard', studentId, yearId, termId],
    queryFn: () => examinationsApi.getReportCard({
      student_id: studentId,
      academic_year_id: yearId || undefined,
      term_id: termId || undefined,
    }),
    enabled: !!studentId,
  })

  const years = yearsRes?.data?.results || yearsRes?.data || []
  const terms = termsRes?.data?.results || termsRes?.data || []
  const students = studentsRes?.data?.results || studentsRes?.data || []
  const report = reportRes?.data || null

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Report Cards</h1>
        <p className="text-sm text-gray-600">View individual student report cards</p>
      </div>

      {/* Selection */}
      <div className="card mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Search Student</label>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input w-full text-sm"
              placeholder="Search by name..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Student</label>
            <select value={studentId} onChange={e => setStudentId(e.target.value)} className="input w-full text-sm">
              <option value="">Select student...</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.name} ({s.roll_number})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Academic Year</label>
            <select value={yearId} onChange={e => { setYearId(e.target.value); setTermId('') }} className="input w-full text-sm">
              <option value="">All Years</option>
              {years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Term</label>
            <select value={termId} onChange={e => setTermId(e.target.value)} className="input w-full text-sm" disabled={!yearId}>
              <option value="">All Terms</option>
              {terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Report Card */}
      {!studentId ? (
        <div className="card text-center py-12 text-gray-400">
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14l9-5-9-5-9 5 9 5z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
          </svg>
          Select a student to view their report card
        </div>
      ) : reportLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
        </div>
      ) : !report ? (
        <div className="card text-center py-8 text-gray-500">No report card data available.</div>
      ) : (
        <div className="card max-w-3xl mx-auto">
          {/* Header */}
          <div className="text-center border-b border-gray-200 pb-4 mb-4">
            <h2 className="text-lg font-bold text-gray-900">{report.school_name || 'Report Card'}</h2>
            <p className="text-sm text-gray-600 mt-1">
              {report.academic_year_name && `Academic Year: ${report.academic_year_name}`}
              {report.term_name && ` | Term: ${report.term_name}`}
            </p>
          </div>

          {/* Student Info */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4 pb-4 border-b border-gray-200">
            <div>
              <p className="text-xs text-gray-500">Student Name</p>
              <p className="text-sm font-medium text-gray-900">{report.student_name}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Roll Number</p>
              <p className="text-sm font-medium text-gray-900">{report.roll_number}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Class</p>
              <p className="text-sm font-medium text-gray-900">{report.class_name}</p>
            </div>
          </div>

          {/* Marks Table */}
          {report.subjects && report.subjects.length > 0 ? (
            <div className="overflow-x-auto mb-4">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <th className="px-3 py-2 text-left">Subject</th>
                    <th className="px-3 py-2 text-center">Total</th>
                    <th className="px-3 py-2 text-center">Obtained</th>
                    <th className="px-3 py-2 text-center">%</th>
                    <th className="px-3 py-2 text-center">Grade</th>
                    <th className="px-3 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {report.subjects.map((s, idx) => (
                    <tr key={idx} className={s.is_pass === false ? 'bg-red-50/30' : ''}>
                      <td className="px-3 py-2 font-medium text-gray-900">{s.subject_name}</td>
                      <td className="px-3 py-2 text-center text-gray-600">{s.total_marks}</td>
                      <td className="px-3 py-2 text-center font-medium">
                        {s.is_absent ? <span className="text-red-500">Absent</span> : s.marks_obtained ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {s.percentage != null ? `${Number(s.percentage).toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {s.grade ? (
                          <span className="px-1.5 py-0.5 bg-primary-100 text-primary-700 rounded text-xs font-medium">{s.grade}</span>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {s.is_pass === true ? (
                          <span className="text-green-600 text-xs font-medium">Pass</span>
                        ) : s.is_pass === false ? (
                          <span className="text-red-600 text-xs font-medium">Fail</span>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* Summary row */}
                {report.summary && (
                  <tfoot>
                    <tr className="bg-gray-50 font-medium">
                      <td className="px-3 py-2">Total</td>
                      <td className="px-3 py-2 text-center">{report.summary.total_marks}</td>
                      <td className="px-3 py-2 text-center">{report.summary.obtained_marks}</td>
                      <td className="px-3 py-2 text-center">
                        {report.summary.percentage != null ? `${Number(report.summary.percentage).toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {report.summary.grade && (
                          <span className="px-1.5 py-0.5 bg-primary-100 text-primary-700 rounded text-xs font-medium">{report.summary.grade}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {report.summary.overall_pass === true ? (
                          <span className="text-green-600 text-xs font-medium">Pass</span>
                        ) : report.summary.overall_pass === false ? (
                          <span className="text-red-600 text-xs font-medium">Fail</span>
                        ) : '—'}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          ) : (
            <p className="text-center text-gray-500 text-sm py-4">No subject marks available.</p>
          )}

          {/* Rank & GPA */}
          {report.summary && (
            <div className="flex items-center gap-6 pt-4 border-t border-gray-200">
              {report.summary.rank && (
                <div>
                  <p className="text-xs text-gray-500">Rank in Class</p>
                  <p className="text-lg font-bold text-primary-700">{report.summary.rank}</p>
                </div>
              )}
              {report.summary.gpa && (
                <div>
                  <p className="text-xs text-gray-500">GPA</p>
                  <p className="text-lg font-bold text-primary-700">{Number(report.summary.gpa).toFixed(2)}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
