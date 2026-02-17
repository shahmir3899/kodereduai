import { useQuery } from '@tanstack/react-query'
import { useAcademicYear } from '../contexts/AcademicYearContext'
import { sessionsApi } from '../services/api'
import { Link } from 'react-router-dom'

const SEVERITY_STYLES = {
  HIGH: 'bg-red-100 text-red-800',
  MEDIUM: 'bg-amber-100 text-amber-800',
  LOW: 'bg-yellow-100 text-yellow-800',
}

const SEVERITY_DOT = {
  HIGH: 'bg-red-500',
  MEDIUM: 'bg-amber-500',
  LOW: 'bg-yellow-500',
}

const TREND_ICONS = {
  declining: { symbol: '\u2193', color: 'text-red-600', label: 'Declining' },
  stable: { symbol: '\u2192', color: 'text-gray-500', label: 'Stable' },
  improving: { symbol: '\u2191', color: 'text-green-600', label: 'Improving' },
}

function SeverityBadge({ level, count }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${SEVERITY_STYLES[level]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${SEVERITY_DOT[level]}`} />
      {level} {count}
    </span>
  )
}

function TrendIndicator({ trend }) {
  const info = TREND_ICONS[trend] || TREND_ICONS.stable
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${info.color}`} title={info.label}>
      {info.symbol} {info.label}
    </span>
  )
}

function SkeletonCard() {
  return (
    <div className="card mb-6 animate-pulse">
      <div className="h-5 bg-gray-200 rounded w-52 mb-4" />
      <div className="h-4 bg-gray-100 rounded w-36 mb-3" />
      <div className="flex gap-2 mb-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-6 bg-gray-100 rounded-full w-20" />
        ))}
      </div>
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-12 bg-gray-50 rounded-lg" />
        ))}
      </div>
    </div>
  )
}

export default function AttendanceRiskWidget() {
  const { activeAcademicYear, hasAcademicYear } = useAcademicYear()

  const { data, isLoading } = useQuery({
    queryKey: ['attendanceRisk', activeAcademicYear?.id],
    queryFn: () => sessionsApi.getAttendanceRisk({ academic_year: activeAcademicYear?.id }),
    enabled: !!activeAcademicYear?.id,
    refetchOnWindowFocus: false,
  })

  if (!hasAcademicYear) return null

  if (isLoading) return <SkeletonCard />

  const result = data?.data
  if (!result || result.at_risk_count === 0) return null

  const topStudents = result.students.slice(0, 5)

  return (
    <div className="card mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-900">Attendance Risk Monitor</h2>
        <span className="text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded-full font-medium">
          AI Predictor
        </span>
      </div>

      {/* Summary */}
      <p className="text-sm text-gray-600 mb-3">
        <span className="font-semibold text-gray-900">{result.at_risk_count}</span> student{result.at_risk_count !== 1 ? 's' : ''} at risk out of{' '}
        <span className="font-semibold text-gray-900">{result.total_students}</span> total
      </p>

      {/* Severity badges */}
      <div className="flex flex-wrap gap-2 mb-4">
        {result.risk_levels.HIGH > 0 && <SeverityBadge level="HIGH" count={result.risk_levels.HIGH} />}
        {result.risk_levels.MEDIUM > 0 && <SeverityBadge level="MEDIUM" count={result.risk_levels.MEDIUM} />}
        {result.risk_levels.LOW > 0 && <SeverityBadge level="LOW" count={result.risk_levels.LOW} />}
      </div>

      {/* Top at-risk students */}
      <div className="space-y-2">
        {topStudents.map((student) => (
          <div
            key={student.student_id}
            className="flex items-start justify-between gap-3 p-3 bg-gray-50 rounded-lg"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-gray-900 truncate">{student.student_name}</span>
                <span className="text-xs text-gray-500">{student.class_name}</span>
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${SEVERITY_STYLES[student.severity]}`}>
                  {student.severity}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs text-gray-600">
                  Attendance: <span className="font-semibold">{student.current_rate}%</span>
                </span>
                <TrendIndicator trend={student.trend} />
              </div>
              {student.day_pattern && (
                <p className="text-xs text-gray-500 mt-1">{student.day_pattern}</p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-gray-500">Predicted</p>
              <p className="text-sm font-semibold text-gray-700">{student.predicted_rate_4w}%</p>
            </div>
          </div>
        ))}
      </div>

      {/* View all link */}
      {result.at_risk_count > 5 && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <Link
            to="/attendance"
            className="text-sm text-primary-600 hover:text-primary-700 font-medium inline-flex items-center"
          >
            View all {result.at_risk_count} at-risk students
            <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      )}
    </div>
  )
}
