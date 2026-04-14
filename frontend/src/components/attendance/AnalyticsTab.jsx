import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { attendanceApi } from '../../services/api'

function getAccuracyColor(accuracy) {
  if (accuracy === null || accuracy === undefined) return 'text-gray-500'
  if (accuracy >= 0.9) return 'text-green-600'
  if (accuracy >= 0.7) return 'text-yellow-600'
  return 'text-red-600'
}
function getAccuracyBg(accuracy) {
  if (accuracy === null || accuracy === undefined) return 'bg-gray-100'
  if (accuracy >= 0.9) return 'bg-green-100'
  if (accuracy >= 0.7) return 'bg-yellow-100'
  return 'bg-red-100'
}

export default function AnalyticsTab({ onGoToConfig }) {
  const [days, setDays] = useState(30)

  const { data: statsData, isLoading, error } = useQuery({
    queryKey: ['accuracyStats', days],
    queryFn: () => attendanceApi.getAccuracyStats({ days }),
  })

  const stats = statsData?.data || {}
  const periodStats = stats.period_stats || {}
  const weeklyTrend = stats.weekly_trend || []
  const commonErrors = stats.common_ocr_errors || []
  const hasData = periodStats.total_corrections > 0 || periodStats.total_predictions > 0

  if (error) {
    return <div className="card text-center py-8"><p className="text-red-600">Failed to load accuracy data</p></div>
  }

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Track how well AI predictions match human confirmations
          {stats.school_name && <span className="ml-1">- {stats.school_name}</span>}
        </p>
        <select value={days} onChange={e => setDays(parseInt(e.target.value))} className="input w-auto">
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
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
          <p className="mt-2 text-sm text-gray-400">Accuracy data is recorded when you confirm attendance on the review page.</p>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className={`card ${getAccuracyBg(periodStats.accuracy)}`}>
              <p className="text-sm text-gray-600">Accuracy</p>
              <p className={`text-2xl sm:text-3xl font-bold ${getAccuracyColor(periodStats.accuracy)}`}>{periodStats.accuracy_pct || 'N/A'}</p>
              <p className="text-xs text-gray-500 mt-1">{periodStats.uploads_confirmed || 0} uploads</p>
            </div>
            <div className="card">
              <p className="text-sm text-gray-600">Predictions</p>
              <p className="text-2xl sm:text-3xl font-bold text-gray-900">{periodStats.total_predictions || 0}</p>
              <p className="text-xs text-gray-500 mt-1">Students processed</p>
            </div>
            <div className="card">
              <p className="text-sm text-gray-600">Corrections</p>
              <p className="text-2xl sm:text-3xl font-bold text-orange-600">{periodStats.attendance_corrections || 0}</p>
              <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                <div className="flex justify-between"><span>False Pos</span><span className="font-medium text-red-600">{periodStats.false_positives || 0}</span></div>
                <div className="flex justify-between"><span>False Neg</span><span className="font-medium text-yellow-600">{periodStats.false_negatives || 0}</span></div>
              </div>
            </div>
            <div className="card">
              <p className="text-sm text-gray-600">Matching</p>
              <p className="text-2xl sm:text-3xl font-bold text-blue-600">{(periodStats.name_mismatches || 0) + (periodStats.roll_mismatches || 0)}</p>
              <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                <div className="flex justify-between"><span>Name</span><span className="font-medium text-blue-600">{periodStats.name_mismatches || 0}</span></div>
                <div className="flex justify-between"><span>Roll</span><span className="font-medium text-blue-600">{periodStats.roll_mismatches || 0}</span></div>
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
                <div className="sm:hidden space-y-3">
                  {weeklyTrend.map((week, idx) => (
                    <div key={idx} className="p-3 border border-gray-200 rounded-lg">
                      <p className="text-sm font-medium text-gray-900">{week.week_start} - {week.week_end}</p>
                      <div className="flex justify-between mt-2 text-xs text-gray-600">
                        <span>{week.uploads_processed} uploads</span>
                        <span>{week.total_predictions} predictions</span>
                        <span className={`px-2 py-0.5 rounded-full font-medium ${getAccuracyBg(week.accuracy)} ${getAccuracyColor(week.accuracy)}`}>{week.accuracy_pct}</span>
                      </div>
                    </div>
                  ))}
                </div>
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
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{week.week_start} - {week.week_end}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">{week.uploads_processed}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">{week.total_predictions}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">{week.corrections}</td>
                          <td className="px-4 py-3 whitespace-nowrap"><span className={`px-2 py-1 rounded-full text-sm font-medium ${getAccuracyBg(week.accuracy)} ${getAccuracyColor(week.accuracy)}`}>{week.accuracy_pct}</span></td>
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
              <button onClick={onGoToConfig} className="text-sm text-primary-600 hover:text-primary-700">Fix in Configuration</button>
            </div>
            {commonErrors.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No OCR errors recorded yet</p>
            ) : (
              <div className="space-y-3">
                {commonErrors.map((err, idx) => (
                  <div key={idx} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2 sm:gap-4">
                      <span className="font-mono text-lg bg-white px-3 py-1 rounded border">"{err.raw_mark}"</span>
                      <div>
                        <p className="text-sm text-gray-900">Misread <span className="font-medium">{err.misread_count}</span> times</p>
                        <p className="text-xs text-gray-500">Avg confidence: {Math.round((err.avg_ocr_confidence || 0) * 100)}%</p>
                      </div>
                    </div>
                    {err.suggestion && <p className="text-sm text-blue-600 max-w-xs text-right">{err.suggestion}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
