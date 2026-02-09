import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { attendanceApi } from '../services/api'

export default function AccuracyDashboardPage() {
  const [days, setDays] = useState(30)

  // Fetch accuracy stats
  const { data: statsData, isLoading, error } = useQuery({
    queryKey: ['accuracyStats', days],
    queryFn: () => attendanceApi.getAccuracyStats({ days })
  })

  const stats = statsData?.data || {}
  const periodStats = stats.period_stats || {}
  const weeklyTrend = stats.weekly_trend || []
  const commonErrors = stats.common_ocr_errors || []

  // Calculate accuracy color
  const getAccuracyColor = (accuracy) => {
    if (accuracy === null || accuracy === undefined) return 'text-gray-500'
    if (accuracy >= 0.9) return 'text-green-600'
    if (accuracy >= 0.7) return 'text-yellow-600'
    return 'text-red-600'
  }

  const getAccuracyBg = (accuracy) => {
    if (accuracy === null || accuracy === undefined) return 'bg-gray-100'
    if (accuracy >= 0.9) return 'bg-green-100'
    if (accuracy >= 0.7) return 'bg-yellow-100'
    return 'bg-red-100'
  }

  if (error) {
    return (
      <div className="card text-center py-8">
        <p className="text-red-600">Failed to load accuracy data</p>
        <p className="text-sm text-gray-500 mt-2">{error.message}</p>
      </div>
    )
  }

  const hasData = periodStats.total_corrections > 0 || periodStats.total_predictions > 0

  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">AI Accuracy Dashboard</h1>
          <p className="text-sm sm:text-base text-gray-600">
            Track how well AI predictions match human confirmations
            {stats.school_name && <span className="ml-1">- {stats.school_name}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value))}
            className="input"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <Link to="/settings" className="btn btn-secondary">
            Configure Mappings
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="card text-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-500">Loading accuracy data...</p>
        </div>
      ) : !hasData ? (
        <div className="card text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <p className="mt-4 text-gray-500 font-medium">No feedback data yet</p>
          <p className="mt-2 text-sm text-gray-400">
            Accuracy data is recorded when you confirm attendance on the review page.
            <br />
            The AI's predictions are compared with your human corrections.
          </p>
          <Link to="/attendance/review" className="mt-4 inline-block text-primary-600 hover:text-primary-700 text-sm">
            Go to Review page
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            {/* Overall Accuracy */}
            <div className={`card ${getAccuracyBg(periodStats.accuracy)}`}>
              <p className="text-sm text-gray-600">Attendance Accuracy</p>
              <p className={`text-2xl sm:text-3xl font-bold ${getAccuracyColor(periodStats.accuracy)}`}>
                {periodStats.accuracy_pct || 'N/A'}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {periodStats.uploads_confirmed || 0} uploads in last {days} days
              </p>
            </div>

            {/* Total Predictions */}
            <div className="card">
              <p className="text-sm text-gray-600">Total Predictions</p>
              <p className="text-2xl sm:text-3xl font-bold text-gray-900">
                {periodStats.total_predictions || 0}
              </p>
              <p className="text-xs text-gray-500 mt-1">Students processed by AI</p>
            </div>

            {/* Attendance Corrections */}
            <div className="card">
              <p className="text-sm text-gray-600">Attendance Corrections</p>
              <p className="text-2xl sm:text-3xl font-bold text-orange-600">
                {periodStats.attendance_corrections || 0}
              </p>
              <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                <div className="flex justify-between">
                  <span>False Pos (AI:A, You:P)</span>
                  <span className="font-medium text-red-600">{periodStats.false_positives || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span>False Neg (AI:P, You:A)</span>
                  <span className="font-medium text-yellow-600">{periodStats.false_negatives || 0}</span>
                </div>
              </div>
            </div>

            {/* Matching Corrections */}
            <div className="card">
              <p className="text-sm text-gray-600">Matching Corrections</p>
              <p className="text-2xl sm:text-3xl font-bold text-blue-600">
                {(periodStats.name_mismatches || 0) + (periodStats.roll_mismatches || 0)}
              </p>
              <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                <div className="flex justify-between">
                  <span>Name mismatches</span>
                  <span className="font-medium text-blue-600">{periodStats.name_mismatches || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span>Roll mismatches</span>
                  <span className="font-medium text-blue-600">{periodStats.roll_mismatches || 0}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Weekly Trend */}
          <div className="card">
            <h3 className="font-medium text-gray-900 mb-4">Weekly Accuracy Trend</h3>
            {weeklyTrend.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No trend data available yet</p>
            ) : (
              <>
              {/* Mobile card view */}
              <div className="sm:hidden space-y-3">
                {weeklyTrend.map((week, idx) => (
                  <div key={idx} className="p-3 border border-gray-200 rounded-lg">
                    <p className="text-sm font-medium text-gray-900">{week.week_start} - {week.week_end}</p>
                    <div className="flex justify-between mt-2 text-xs text-gray-600">
                      <span>{week.uploads_processed} uploads</span>
                      <span>{week.total_predictions} predictions</span>
                      <span className={`px-2 py-0.5 rounded-full font-medium ${getAccuracyBg(week.accuracy)} ${getAccuracyColor(week.accuracy)}`}>
                        {week.accuracy_pct}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop table view */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Week</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Uploads</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Predictions</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Corrections</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Accuracy</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {weeklyTrend.map((week, idx) => (
                      <tr key={idx}>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                          {week.week_start} - {week.week_end}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                          {week.uploads_processed}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                          {week.total_predictions}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                          {week.corrections}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`px-2 py-1 rounded-full text-sm font-medium ${getAccuracyBg(week.accuracy)} ${getAccuracyColor(week.accuracy)}`}>
                            {week.accuracy_pct}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </div>

          {/* Common OCR Errors */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-gray-900">Common OCR Errors</h3>
              <Link to="/settings" className="text-sm text-primary-600 hover:text-primary-700">
                Fix in Settings
              </Link>
            </div>
            {commonErrors.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No OCR errors recorded yet</p>
            ) : (
              <div className="space-y-3">
                {commonErrors.map((err, idx) => (
                  <div key={idx} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2 sm:gap-4">
                      <span className="font-mono text-lg bg-white px-3 py-1 rounded border">
                        "{err.raw_mark}"
                      </span>
                      <div>
                        <p className="text-sm text-gray-900">
                          Misread <span className="font-medium">{err.misread_count}</span> times
                        </p>
                        <p className="text-xs text-gray-500">
                          Avg OCR confidence: {Math.round((err.avg_ocr_confidence || 0) * 100)}%
                        </p>
                      </div>
                    </div>
                    {err.suggestion && (
                      <p className="text-sm text-blue-600 max-w-xs text-right">
                        {err.suggestion}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Info Box */}
          <div className="card bg-blue-50 border-blue-200">
            <div className="flex gap-4">
              <svg className="w-6 h-6 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h4 className="font-medium text-blue-800">How This Works</h4>
                <p className="text-sm text-blue-700 mt-1">
                  Every time you confirm attendance on the review page, your corrections are recorded:
                </p>
                <ul className="text-sm text-blue-700 mt-2 space-y-1 list-disc ml-4">
                  <li><strong>Attendance accuracy</strong> - Did AI correctly detect Present/Absent?</li>
                  <li><strong>Name matching</strong> - Did AI match the OCR name to the correct student? (Reject with X on review page)</li>
                  <li><strong>Roll matching</strong> - Did AI map the register serial to the correct roll number?</li>
                </ul>
                <p className="text-sm text-blue-700 mt-2">
                  More confirmations = better data. Over time, patterns emerge to improve AI accuracy.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
