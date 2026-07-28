import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { sessionsApi } from '../../services/api'
import { useAcademicYear } from '../../contexts/AcademicYearContext'

const SEVERITY_STYLES = {
  HIGH: 'bg-red-100 text-red-800',
  MEDIUM: 'bg-amber-100 text-amber-800',
  LOW: 'bg-yellow-100 text-yellow-800',
}

const SEVERITY_BORDER = {
  HIGH: 'border-l-red-500',
  MEDIUM: 'border-l-amber-500',
  LOW: 'border-l-yellow-500',
}

const TREND_ICONS = {
  declining: { symbol: '↓', color: 'text-red-600', label: 'Declining' },
  stable: { symbol: '→', color: 'text-gray-500', label: 'Stable' },
  improving: { symbol: '↑', color: 'text-green-600', label: 'Improving' },
}

export default function AtRiskStudentsPage() {
  const { activeAcademicYear, hasAcademicYear } = useAcademicYear()
  const [severityFilter, setSeverityFilter] = useState('')
  const [classFilter, setClassFilter] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['attendanceRisk', activeAcademicYear?.id],
    queryFn: () => sessionsApi.getAttendanceRisk({ academic_year: activeAcademicYear?.id }),
    enabled: !!activeAcademicYear?.id,
  })

  const result = data?.data
  const students = result?.students || []

  const classOptions = useMemo(
    () => [...new Set(students.map((s) => s.class_name).filter(Boolean))].sort(),
    [students],
  )

  const filtered = students.filter((s) => {
    if (severityFilter && s.severity !== severityFilter) return false
    if (classFilter && s.class_name !== classFilter) return false
    return true
  })

  if (!hasAcademicYear) {
    return <div className="card text-center py-12 text-gray-500">Select an academic year to view attendance risk.</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">At-Risk Students</h1>
          <p className="text-sm text-gray-500 mt-1">
            Students flagged by the AI Attendance Risk Predictor as at risk, or predicted to fall below the
            attendance threshold within 4 weeks.
          </p>
        </div>
        {result && (
          <div className="text-right shrink-0">
            <p className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{result.at_risk_count}</span> at risk of{' '}
              <span className="font-semibold text-gray-900">{result.total_students}</span> total
            </p>
            {result.cached_at && (
              <p className="text-xs text-gray-400 mt-0.5">As of {new Date(result.cached_at).toLocaleString()}</p>
            )}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="text-sm border-gray-300 rounded-lg"
        >
          <option value="">All Severities</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
        {classOptions.length > 0 && (
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="text-sm border-gray-300 rounded-lg"
          >
            <option value="">All Classes</option>
            {classOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="text-center py-10 text-gray-500">Loading at-risk students...</div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="mt-4 text-gray-500 font-medium">
            {students.length === 0 ? 'No students currently at risk' : 'No students match these filters'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => {
            const trend = TREND_ICONS[s.trend] || TREND_ICONS.stable
            return (
              <div key={s.student_id} className={`card border-l-4 ${SEVERITY_BORDER[s.severity]}`}>
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-gray-900">{s.student_name}</span>
                      <span className="text-xs text-gray-500">{s.class_name}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${SEVERITY_STYLES[s.severity]}`}>
                        {s.severity}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
                      <span>Attendance: <span className="font-semibold">{s.current_rate}%</span></span>
                      <span className={`inline-flex items-center gap-0.5 font-medium ${trend.color}`}>
                        {trend.symbol} {trend.label}
                      </span>
                      <span>Predicted (4w): <span className="font-semibold">{s.predicted_rate_4w}%</span></span>
                      {s.consecutive_absent_days > 0 && (
                        <span className="text-red-600 font-medium">{s.consecutive_absent_days} days in a row absent</span>
                      )}
                      {s.excused_leave_days > 0 && (
                        <span className="text-gray-400">{s.excused_leave_days} excused leave day(s) excluded</span>
                      )}
                    </div>
                    {s.day_pattern && (
                      <p className="text-xs text-gray-500 mt-1">{s.day_pattern}</p>
                    )}
                    <p className="text-sm text-gray-800 mt-2">{s.suggested_action}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
