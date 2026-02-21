import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { attendanceApi } from '../services/api'

export default function AccuracyDashboardPage() {
  const [days, setDays] = useState(30)
  const queryClient = useQueryClient()

  // Fetch accuracy stats
  const { data: statsData, isLoading, error } = useQuery({
    queryKey: ['accuracyStats', days],
    queryFn: () => attendanceApi.getAccuracyStats({ days })
  })

  // Fetch threshold status
  const { data: thresholdData } = useQuery({
    queryKey: ['thresholdStatus'],
    queryFn: () => attendanceApi.getThresholdStatus()
  })

  const thresholdStatus = thresholdData?.data || {}
  const thresholds = thresholdStatus.thresholds || {}
  const defaults = thresholdStatus.defaults || {}

  // Toggle auto-tune mutation
  const tuneMutation = useMutation({
    mutationFn: (data) => attendanceApi.tuneThresholds(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['thresholdStatus'] })
  })

  // Fetch drift history
  const { data: driftData } = useQuery({
    queryKey: ['driftHistory', days],
    queryFn: () => attendanceApi.getDriftHistory({ days })
  })

  const driftHistory = driftData?.data || {}
  const driftSnapshots = driftHistory.snapshots || []
  const activeDrift = driftHistory.active_drift || {}

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

          {/* AI Threshold Configuration */}
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium text-gray-900">AI Threshold Configuration</h3>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-sm text-gray-600">Auto-tune</span>
                <input
                  type="checkbox"
                  checked={thresholdStatus.auto_tune_enabled || false}
                  onChange={(e) => tuneMutation.mutate({ auto_tune_enabled: e.target.checked })}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  disabled={tuneMutation.isPending}
                />
              </label>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              These thresholds control how strictly the AI matches names and interprets marks.
              Enable auto-tuning to let the system adjust thresholds weekly based on your correction patterns.
            </p>

            {thresholdStatus.auto_tune_enabled ? (
              <p className="text-xs text-green-700 bg-green-50 rounded px-3 py-1.5 mb-3">
                Auto-tune is active. Last tuned: {thresholdStatus.last_tuned_at
                  ? new Date(thresholdStatus.last_tuned_at).toLocaleDateString()
                  : 'Never — needs 50+ processed uploads'}
              </p>
            ) : (
              <p className="text-xs text-gray-500 bg-gray-50 rounded px-3 py-1.5 mb-3">
                Auto-tune is off. Enable it after processing 50+ uploads for best results.
              </p>
            )}

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Threshold</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Current</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Default</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {Object.entries(defaults).map(([key, defaultVal]) => (
                    <tr key={key}>
                      <td className="px-3 py-2 text-gray-700">{key.replace(/_/g, ' ')}</td>
                      <td className="px-3 py-2 font-medium">
                        <span className={thresholds[key] !== defaultVal ? 'text-primary-600' : 'text-gray-900'}>
                          {thresholds[key] ?? defaultVal}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-500">{defaultVal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {(thresholdStatus.tune_history || []).length > 0 && (
              <div className="mt-4 border-t pt-3">
                <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Recent Auto-Tune Changes</h4>
                <div className="space-y-1.5">
                  {(thresholdStatus.tune_history || []).slice(-3).reverse().map((entry, idx) => (
                    <div key={idx} className="text-xs bg-gray-50 rounded p-2">
                      <span className="text-gray-500">{new Date(entry.date).toLocaleDateString()}</span>
                      {entry.changes.map((c, i) => (
                        <span key={i} className="ml-2 text-gray-700">{c}</span>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Pipeline Configuration */}
          <div className="card">
            <h3 className="font-medium text-gray-900 mb-2">Pipeline Configuration</h3>
            <p className="text-sm text-gray-500 mb-4">
              Choose which AI provider processes your registers. Enable fallback to try alternatives
              if the primary fails. Voting mode runs multiple providers and cross-validates for maximum accuracy.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Primary Provider</label>
                <select
                  value={thresholds.primary || thresholdStatus.thresholds?.primary || 'google'}
                  disabled
                  className="w-full text-sm border-gray-300 rounded-lg bg-gray-50"
                >
                  <option value="google">Google Vision</option>
                  <option value="groq">Groq Vision</option>
                  <option value="tesseract">Tesseract (Legacy)</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Fallback Chain</label>
                <p className="text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded-lg">
                  {(thresholdStatus.fallback_chain || ['groq', 'tesseract']).join(' → ') || 'None'}
                </p>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Multi-Pipeline Voting</label>
                <p className="text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded-lg">
                  {thresholdStatus.voting_enabled ? 'Enabled (slower, more accurate)' : 'Disabled'}
                </p>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-3">
              Pipeline settings are configured per-school by your administrator. Contact support to change providers.
            </p>
          </div>

          {/* Accuracy Drift Monitor */}
          <div className="card">
            <h3 className="font-medium text-gray-900 mb-2">Accuracy Drift Monitor</h3>
            <p className="text-sm text-gray-500 mb-4">
              Tracks daily AI accuracy. Red markers indicate significant drops from the 30-day baseline.
              Drift often means register format changed or new handwriting styles appeared.
            </p>

            {activeDrift?.detected && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm font-medium text-red-800">
                  Accuracy drift detected on {activeDrift.date}!
                </p>
                <p className="text-sm text-red-700 mt-1">
                  {activeDrift.details?.message || 'Accuracy dropped significantly from baseline.'}
                  {' '}Review recent uploads and consider adjusting thresholds.
                </p>
              </div>
            )}

            {driftSnapshots.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No drift data yet. Snapshots are recorded daily after confirmed uploads.</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="flex items-end gap-1 h-32 min-w-fit">
                  {driftSnapshots.map((s, idx) => {
                    const height = s.accuracy != null ? Math.max(s.accuracy * 100, 5) : 5
                    return (
                      <div key={idx} className="flex flex-col items-center" title={`${s.date}: ${s.accuracy != null ? (s.accuracy * 100).toFixed(1) + '%' : 'N/A'}${s.drift_detected ? ' [DRIFT]' : ''}`}>
                        <div
                          className={`w-3 rounded-t ${s.drift_detected ? 'bg-red-500' : s.accuracy >= 0.9 ? 'bg-green-500' : s.accuracy >= 0.7 ? 'bg-yellow-500' : 'bg-red-400'}`}
                          style={{ height: `${height}%` }}
                        />
                        {idx % 5 === 0 && (
                          <span className="text-[9px] text-gray-400 mt-1 -rotate-45 origin-top-left whitespace-nowrap">
                            {new Date(s.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-500 rounded" /> &ge;90%</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 bg-yellow-500 rounded" /> 70-89%</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-400 rounded" /> &lt;70%</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-500 rounded" /> Drift event</span>
                </div>
              </div>
            )}
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
