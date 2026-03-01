import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { studentPortalApi, notificationsApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import NotificationsFeed from '../../components/dashboard/NotificationsFeed'

export default function StudentDashboard() {
  const { user } = useAuth()

  const { data: dashboardData, isLoading, error } = useQuery({
    queryKey: ['studentDashboard'],
    queryFn: () => studentPortalApi.getDashboard(),
  })

  const { data: resultsData } = useQuery({
    queryKey: ['studentExamResults'],
    queryFn: () => studentPortalApi.getExamResults({ page_size: 5 }),
    staleTime: 5 * 60 * 1000,
  })

  const dashboard = dashboardData?.data || {}
  const student = dashboard.student || {}
  const stats = dashboard.stats || {}
  const todayTimetable = dashboard.today_timetable || []
  const upcomingAssignments = dashboard.upcoming_assignments || []
  const recentResults = resultsData?.data?.results || resultsData?.data || []

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <svg className="w-10 h-10 mx-auto text-red-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        <h3 className="text-base font-medium text-red-900 mb-1">Failed to load dashboard</h3>
        <p className="text-sm text-red-600">{error.message || 'Please try again later.'}</p>
      </div>
    )
  }

  // Derive last exam score from results
  const lastResult = recentResults[0]
  const lastExamScore = lastResult?.percentage ?? lastResult?.total_obtained_percentage ?? null

  // Current time for timetable highlighting
  const now = new Date()
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  return (
    <div className="space-y-6">
      {/* Welcome Card */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-5 sm:p-6 text-white">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
            <span className="text-2xl font-bold">
              {(student.name || user?.first_name || user?.username || '?').charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold truncate">
              Welcome, {student.name || user?.first_name || user?.username || 'Student'}!
            </h1>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-blue-100 text-sm">
              {student.class_name && <span>Class: {student.class_name}{student.section ? ` - ${student.section}` : ''}</span>}
              {student.roll_number && <span>Roll #: {student.roll_number}</span>}
              {student.admission_number && <span>Adm #: {student.admission_number}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards — 4 across */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-green-100 text-green-600 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-500">Attendance</p>
              <p className={`text-lg font-bold ${
                (stats.attendance_rate ?? 0) >= 75 ? 'text-green-700' :
                (stats.attendance_rate ?? 0) >= 60 ? 'text-yellow-700' : 'text-red-700'
              }`}>
                {stats.attendance_rate != null ? `${stats.attendance_rate}%` : 'N/A'}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-100 text-red-600 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-500">Fee Due</p>
              <p className={`text-lg font-bold ${
                (stats.fee_outstanding ?? 0) > 0 ? 'text-red-700' : 'text-green-700'
              }`}>
                {stats.fee_outstanding != null ? `PKR ${Number(stats.fee_outstanding).toLocaleString()}` : 'N/A'}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-500">Assignments</p>
              <p className="text-lg font-bold text-purple-700">
                {stats.upcoming_assignments_count ?? upcomingAssignments.length}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-500">Last Exam</p>
              <p className={`text-lg font-bold ${
                lastExamScore == null ? 'text-gray-400' :
                lastExamScore >= 60 ? 'text-blue-700' :
                lastExamScore >= 40 ? 'text-yellow-700' : 'text-red-700'
              }`}>
                {lastExamScore != null ? `${Math.round(lastExamScore)}%` : 'N/A'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left column */}
        <div className="lg:col-span-3 space-y-6">
          {/* Today's Timetable */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">Today's Timetable</h2>
              <Link to="/student/timetable" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                View Full
              </Link>
            </div>

            {todayTimetable.length === 0 ? (
              <div className="p-8 text-center">
                <svg className="w-10 h-10 mx-auto text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-gray-500">No classes scheduled for today</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {todayTimetable.map((slot, idx) => {
                  const startTime = slot.start_time || slot.slot_start_time || ''
                  const endTime = slot.end_time || slot.slot_end_time || ''
                  const isCurrent = startTime && endTime && currentTime >= startTime.slice(0, 5) && currentTime <= endTime.slice(0, 5)

                  return (
                    <div
                      key={idx}
                      className={`px-5 py-3 flex items-center gap-4 ${isCurrent ? 'bg-blue-50 border-l-3 border-l-blue-500' : 'hover:bg-gray-50'}`}
                    >
                      <div className="text-center shrink-0 w-14">
                        <p className={`text-xs font-medium ${isCurrent ? 'text-blue-600' : 'text-gray-500'}`}>
                          {startTime ? formatTime(startTime) : `Slot ${slot.slot_number || idx + 1}`}
                        </p>
                        {endTime && <p className="text-xs text-gray-400">{formatTime(endTime)}</p>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${isCurrent ? 'text-blue-900' : 'text-gray-900'}`}>
                          {slot.subject_name || slot.subject || '-'}
                        </p>
                        <p className="text-xs text-gray-500">
                          {slot.teacher_name || slot.teacher || '-'}
                          {(slot.room || slot.room_number) ? ` · Room ${slot.room || slot.room_number}` : ''}
                        </p>
                      </div>
                      {isCurrent && (
                        <span className="text-xs font-semibold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full shrink-0">Now</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Upcoming Assignments */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">Upcoming Assignments</h2>
              <Link to="/student/assignments" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                View All
              </Link>
            </div>

            {upcomingAssignments.length === 0 ? (
              <div className="p-8 text-center">
                <svg className="w-10 h-10 mx-auto text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <p className="text-sm text-gray-500">No upcoming assignments</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {upcomingAssignments.map((assignment, idx) => {
                  const dueDate = assignment.due_date ? new Date(assignment.due_date) : null
                  const daysLeft = dueDate ? Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24)) : null

                  return (
                    <div key={assignment.id || idx} className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-gray-50">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{assignment.title}</p>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-gray-500">{assignment.subject_name || assignment.subject}</span>
                          {dueDate && (
                            <span className={`text-xs ${daysLeft != null && daysLeft <= 1 ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                              {daysLeft != null && daysLeft <= 0 ? 'Due today' :
                               daysLeft === 1 ? 'Due tomorrow' :
                               `Due ${dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                            </span>
                          )}
                        </div>
                      </div>
                      {assignment.type && (
                        <span className={`px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${
                          assignment.type === 'HOMEWORK' ? 'bg-blue-100 text-blue-800' :
                          assignment.type === 'PROJECT' ? 'bg-purple-100 text-purple-800' :
                          assignment.type === 'TEST' ? 'bg-red-100 text-red-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {assignment.type}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Recent Exam Results */}
          {recentResults.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
                <h2 className="text-base font-semibold text-gray-900">Recent Results</h2>
                <Link to="/student/results" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                  View All
                </Link>
              </div>
              <div className="divide-y divide-gray-100">
                {recentResults.slice(0, 4).map((result) => {
                  const pct = result.percentage ?? result.total_obtained_percentage
                  return (
                    <div key={result.id || result.exam_id} className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-gray-50">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {result.exam_name || result.exam_title || result.subject_name || 'Exam'}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          {result.subject_name && result.exam_name && (
                            <span className="text-xs text-gray-500">{result.subject_name}</span>
                          )}
                          {result.date && (
                            <span className="text-xs text-gray-400">
                              {new Date(result.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {(result.marks_obtained != null && result.total_marks != null) && (
                          <span className="text-xs text-gray-500">{result.marks_obtained}/{result.total_marks}</span>
                        )}
                        {pct != null && (
                          <span className={`text-sm font-bold px-2 py-0.5 rounded ${
                            pct >= 80 ? 'bg-green-100 text-green-700' :
                            pct >= 60 ? 'bg-blue-100 text-blue-700' :
                            pct >= 40 ? 'bg-yellow-100 text-yellow-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {Math.round(pct)}%
                          </span>
                        )}
                        {result.grade && !pct && (
                          <span className="text-sm font-bold text-gray-700">{result.grade}</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Quick Links */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Quick Links</h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Attendance', href: '/student/attendance', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', color: 'green' },
                { label: 'Results', href: '/student/results', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z', color: 'blue' },
                { label: 'Assignments', href: '/student/assignments', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2', color: 'purple' },
                { label: 'Timetable', href: '/student/timetable', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', color: 'amber' },
                { label: 'Fees', href: '/student/fees', icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z', color: 'red' },
                { label: 'Study Helper', href: '/student/study-helper', icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z', color: 'sky' },
              ].map((link) => (
                <Link
                  key={link.href}
                  to={link.href}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className={`w-7 h-7 rounded-md bg-${link.color}-100 flex items-center justify-center shrink-0`}>
                    <svg className={`w-4 h-4 text-${link.color}-600`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={link.icon} />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-gray-700">{link.label}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Notifications */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Notifications</h3>
            <NotificationsFeed limit={5} />
          </div>
        </div>
      </div>
    </div>
  )
}

function formatTime(time) {
  if (!time) return ''
  const parts = time.split(':')
  if (parts.length < 2) return time
  const h = parseInt(parts[0])
  const m = parts[1]
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${m} ${ampm}`
}
