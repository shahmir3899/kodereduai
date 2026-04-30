import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { academicsApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

const COLORS = ['#4f46e5', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#f97316']

export default function AcademicsAnalyticsPage() {
  const { isSuperAdmin, effectiveRole } = useAuth()
  const queryClient = useQueryClient()
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 3)
    return d.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0])
  const [months, setMonths] = useState(6)
  const [scope, setScope] = useState(isSuperAdmin ? 'global' : 'school')

  const phase1Enabled = import.meta.env.VITE_ANALYTICS_V2_PHASE1 !== 'false'
  const phase2Enabled = import.meta.env.VITE_ANALYTICS_V2_PHASE2 !== 'false'

  const { data: overviewRes, isLoading, isError, error } = useQuery({
    queryKey: ['academicsAnalytics', 'overview', dateFrom, dateTo, months, scope, isSuperAdmin],
    queryFn: () => academicsApi.getAnalytics({
      type: 'overview',
      date_from: dateFrom,
      date_to: dateTo,
      months,
      ...(isSuperAdmin ? { scope } : {}),
    }),
  })

  const data = overviewRes?.data || {}
  const signals = data.signals || {}
  const subjectAttendance = data.subject_attendance?.subjects || []
  const teacherEffectiveness = data.teacher_effectiveness?.teachers || []
  const slotRecommendations = data.slot_recommendations?.recommendations || []
  const trends = data.attendance_trends?.months || []
  const lessonPlanCoverage = data.lesson_plan_coverage || signals.lms?.lesson_plan_coverage || {}
  const assignmentEngagement = data.assignment_engagement || signals.lms?.assignment_engagement || {}
  const curriculumCoverage = data.curriculum_coverage_pace || signals.coverage?.curriculum_coverage_pace || {}
  const alerts = data.alerts?.items || []
  const topActions = data.recommendations?.prioritized_actions?.top_actions || []
  const riskIndex = data.risk_index || {}
  const interventionImpact = data.intervention_impact || {}
  const attendanceHealth = Math.max(0, 100 - (riskIndex.components?.attendance_deficit ?? 0))
  const submissionHealth = Math.max(0, 100 - (riskIndex.components?.submission_deficit ?? 0))
  const coverageHealth = Math.max(0, 100 - (riskIndex.components?.coverage_deficit ?? 0))
  const healthBars = [
    { key: 'attendance', label: 'Attendance', value: attendanceHealth },
    { key: 'submission', label: 'Submission', value: submissionHealth },
    { key: 'coverage', label: 'Coverage', value: coverageHealth },
  ]

  const alertMutation = useMutation({
    mutationFn: ({ alertId, status }) => academicsApi.updateAnalyticsAlert({ alert_id: alertId, status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academicsAnalytics'] })
    },
  })

  // Transform trends for recharts
  const trendLines = []
  const classNames = new Set()
  trends.forEach(m => {
    (m.classes || []).forEach(c => classNames.add(c.class_name))
  })
  const classNameArr = [...classNames]
  const trendData = trends.map(m => {
    const point = { month: m.month }
    ;(m.classes || []).forEach(c => { point[c.class_name] = c.rate })
    return point
  })

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">AI Analytics</h1>
          <p className="text-sm text-gray-600">Data-driven insights for academic planning, LMS engagement, and coverage risk</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          {isSuperAdmin && (
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="input text-sm"
            >
              <option value="global">Global (All Schools)</option>
              <option value="school">Current School</option>
            </select>
          )}
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="input text-sm"
          />
          <span className="text-gray-400 text-sm">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="input text-sm"
          />
        </div>
      </div>
      <div className="mb-4">
        <p className="text-xs text-gray-500">
          Role context: <span className="font-medium">{effectiveRole}</span> | Scope: <span className="font-medium uppercase">{data.meta?.scope || scope}</span>
        </p>
        <p className="text-xs text-gray-500 mt-1">
          {effectiveRole === 'SCHOOL_ADMIN' || effectiveRole === 'PRINCIPAL'
            ? 'These indicators are school-level aggregates for Admin/Principal.'
            : isSuperAdmin
              ? 'These indicators are aggregate metrics based on selected scope (school/global).'
              : 'These indicators are aggregate metrics for the selected scope.'}
        </p>
      </div>

      {isLoading ? (
        <div className="text-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-3"></div>
          <p className="text-sm text-gray-500">Analyzing data...</p>
        </div>
      ) : isError ? (
        <div className="card text-center py-12">
          <svg className="w-12 h-12 text-red-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 mb-2">Failed to load analytics</h3>
          <p className="text-sm text-gray-500">{error?.response?.data?.detail || error?.message || 'Something went wrong.'}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {phase1Enabled && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="card">
                <p className="text-xs text-gray-500 mb-1">Lesson Plans Published</p>
                <p className="text-2xl font-bold text-gray-900">{lessonPlanCoverage.published_count ?? 0}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {lessonPlanCoverage.active_classes_covered ?? 0} classes, {lessonPlanCoverage.active_subjects_covered ?? 0} subjects
                </p>
              </div>
              <div className="card">
                <p className="text-xs text-gray-500 mb-1">Assignment Submission Rate</p>
                <p className="text-2xl font-bold text-gray-900">{assignmentEngagement.submission_rate ?? 'N/A'}{assignmentEngagement.submission_rate != null ? '%' : ''}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {assignmentEngagement.submitted_count ?? 0} / {assignmentEngagement.expected_submissions ?? 0} expected
                </p>
              </div>
              <div className="card">
                <p className="text-xs text-gray-500 mb-1">Curriculum Coverage</p>
                <p className="text-2xl font-bold text-gray-900">{curriculumCoverage.coverage_rate ?? 'N/A'}{curriculumCoverage.coverage_rate != null ? '%' : ''}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {curriculumCoverage.covered_topics ?? 0} covered, {curriculumCoverage.backlog_topics ?? 0} backlog
                </p>
              </div>
            </div>
          )}

          {/* Row 1: Subject Attendance by Weekday + Teacher Effectiveness */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Subject Attendance by Weekday */}
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Subject Attendance by Weekday</h2>
              {subjectAttendance.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-8">No attendance data available for this period</p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={subjectAttendance} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="subject_name" tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
                    <Tooltip formatter={(val) => val != null ? `${val.toFixed(1)}%` : 'N/A'} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="mon_rate" name="Mon" fill="#4f46e5" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="tue_rate" name="Tue" fill="#06b6d4" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="wed_rate" name="Wed" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="thu_rate" name="Thu" fill="#10b981" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="fri_rate" name="Fri" fill="#ef4444" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="sat_rate" name="Sat" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Teacher Effectiveness */}
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Teacher Effectiveness</h2>
              {teacherEffectiveness.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-8">No teacher effectiveness data available</p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={teacherEffectiveness.slice(0, 10)}
                    layout="vertical"
                    margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                    <YAxis type="category" dataKey="teacher_name" width={100} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(val) => val != null ? `${val.toFixed(1)}%` : 'N/A'} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="avg_class_attendance_rate" name="Class Attendance" fill="#4f46e5" radius={[0, 2, 2, 0]} />
                    <Bar dataKey="avg_rating_scaled" name="Rating (scaled)" fill="#f59e0b" radius={[0, 2, 2, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Row 2: Day Recommendations */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Optimal Day Recommendations</h2>
            {slotRecommendations.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">Not enough data to generate recommendations. Ensure attendance records exist for timetabled subjects.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {slotRecommendations.map((rec, i) => (
                  <div key={i} className="p-3 rounded-lg border border-gray-200 bg-gray-50">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="inline-block w-2 h-2 rounded-full bg-indigo-400"></span>
                      <span className="font-medium text-sm text-gray-900">{rec.subject_name}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-gray-600 mb-1">
                      <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                      </svg>
                      Best on <span className="font-medium">{rec.recommended_day}</span>
                    </div>
                    <p className="text-xs text-gray-500">{rec.evidence}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {phase1Enabled && (
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Alerts (Rule-based)</h2>
              {alerts.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">No active alerts for this filter range.</p>
              ) : (
                <div className="space-y-3">
                  {alerts.map((alert, idx) => (
                    <div key={`${alert.alert_code}-${idx}`} className="border border-gray-200 rounded-lg p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{alert.title}</p>
                          <p className="text-xs text-gray-600 mt-1">{alert.rationale}</p>
                          <p className="text-xs text-gray-500 mt-1">Action: {alert.suggested_action}</p>
                        </div>
                        <span className={`text-[10px] px-2 py-1 rounded-full font-medium ${
                          alert.severity === 'high' ? 'bg-red-100 text-red-700' :
                          alert.severity === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {alert.severity}
                        </span>
                      </div>
                      {alert.id && (
                        <div className="mt-3 flex gap-2">
                          <button
                            className="text-xs px-2 py-1 border rounded hover:bg-gray-50"
                            disabled={alertMutation.isPending}
                            onClick={() => alertMutation.mutate({ alertId: alert.id, status: 'acknowledged' })}
                          >
                            Acknowledge
                          </button>
                          <button
                            className="text-xs px-2 py-1 border rounded hover:bg-gray-50"
                            disabled={alertMutation.isPending}
                            onClick={() => alertMutation.mutate({ alertId: alert.id, status: 'resolved' })}
                          >
                            Resolve
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {phase2Enabled && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="card">
                <h2 className="text-sm font-semibold text-gray-900 mb-4">Risk Index</h2>
                <p className="text-2xl font-bold text-gray-900 mb-1">{riskIndex.score ?? 'N/A'}</p>
                <p className="text-xs text-gray-500 mb-3">
                  Level: {riskIndex.level || 'unknown'} | Scope: {(data.meta?.scope || scope).toUpperCase()}
                </p>
                <div className="space-y-2">
                  {healthBars.map((bar) => (
                    <div key={bar.key}>
                      <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                        <span>{bar.label} (out of 100)</span>
                        <span className="font-medium text-gray-900">{bar.value.toFixed(1)}</span>
                      </div>
                      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            bar.value >= 80 ? 'bg-green-500' : bar.value >= 60 ? 'bg-amber-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${Math.max(0, Math.min(bar.value, 100))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <h2 className="text-sm font-semibold text-gray-900 mb-4">Intervention Impact</h2>
                <p className="text-2xl font-bold text-gray-900 mb-1">
                  {interventionImpact.delta == null ? 'N/A' : `${interventionImpact.delta}%`}
                </p>
                <p className="text-xs text-gray-500">Change in attendance across recent vs previous {interventionImpact.window_days || 30}-day windows</p>
                <div className="mt-3 text-xs text-gray-600 space-y-1">
                  <p>Recent: {interventionImpact.recent_period_rate ?? 'N/A'}%</p>
                  <p>Previous: {interventionImpact.previous_period_rate ?? 'N/A'}%</p>
                </div>
              </div>
            </div>
          )}

          {phase2Enabled && (
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Top 5 Actions</h2>
              {topActions.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">No prioritized actions available yet.</p>
              ) : (
                <div className="space-y-2">
                  {topActions.map((action, idx) => (
                    <div key={`${action.source_alert_code}-${idx}`} className="border border-gray-200 rounded-lg p-3">
                      <div className="flex justify-between items-center gap-2">
                        <p className="text-sm font-medium text-gray-900">{action.title}</p>
                        <p className="text-xs text-gray-500">Impact: {action.impact_score}</p>
                      </div>
                      <p className="text-xs text-gray-600 mt-1">{action.action}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Row 3: Attendance Trends */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-900">Monthly Attendance Trends</h2>
              <select
                value={months}
                onChange={e => setMonths(parseInt(e.target.value))}
                className="input text-xs py-1 px-2 w-auto"
              >
                <option value={3}>Last 3 months</option>
                <option value={6}>Last 6 months</option>
                <option value={12}>Last 12 months</option>
              </select>
            </div>
            {trendData.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-8">No trend data available yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={trendData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip formatter={(val) => `${val?.toFixed(1)}%`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {classNameArr.map((cls, i) => (
                    <Line
                      key={cls}
                      type="monotone"
                      dataKey={cls}
                      name={cls}
                      stroke={COLORS[i % COLORS.length]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
