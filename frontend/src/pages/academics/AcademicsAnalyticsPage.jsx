import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { academicsApi } from '../../services/api'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts'

const COLORS = ['#4f46e5', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#f97316']

export default function AcademicsAnalyticsPage() {
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 3)
    return d.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0])
  const [months, setMonths] = useState(6)

  const { data: overviewRes, isLoading, isError, error } = useQuery({
    queryKey: ['academicsAnalytics', 'overview', dateFrom, dateTo, months],
    queryFn: () => academicsApi.getAnalytics({ type: 'overview', date_from: dateFrom, date_to: dateTo, months }),
  })

  const data = overviewRes?.data || {}
  const subjectAttendance = data.subject_attendance?.subjects || []
  const teacherEffectiveness = data.teacher_effectiveness?.teachers || []
  const slotRecommendations = data.slot_recommendations?.recommendations || []
  const trends = data.attendance_trends?.months || []

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
          <p className="text-sm text-gray-600">Data-driven insights for academic planning</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          {/* Row 1: Subject Attendance by Time + Teacher Effectiveness */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Subject Attendance by Time Slot */}
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">Subject Attendance by Time Slot</h2>
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
                    <Bar dataKey="morning_rate" name="Morning" fill="#4f46e5" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="afternoon_rate" name="Afternoon" fill="#06b6d4" radius={[2, 2, 0, 0]} />
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

          {/* Row 2: Slot Recommendations */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Optimal Slot Recommendations</h2>
            {slotRecommendations.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">Not enough data to generate recommendations. Ensure attendance records exist for timetabled subjects.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {slotRecommendations.map((rec, i) => (
                  <div key={i} className="p-3 rounded-lg border border-gray-200 bg-gray-50">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`inline-block w-2 h-2 rounded-full ${rec.recommended_time === 'morning' ? 'bg-amber-400' : 'bg-indigo-400'}`}></span>
                      <span className="font-medium text-sm text-gray-900">{rec.subject_name}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-gray-600 mb-1">
                      <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                      </svg>
                      Best in <span className="font-medium capitalize">{rec.recommended_time}</span>
                    </div>
                    <p className="text-xs text-gray-500">{rec.evidence}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

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
