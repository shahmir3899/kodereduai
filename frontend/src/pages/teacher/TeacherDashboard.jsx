import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { academicsApi, attendanceApi, lmsApi, notificationsApi } from '../../services/api'

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

export default function TeacherDashboard() {
  const { user } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const todayDay = DAY_NAMES[new Date().getDay()]

  // Today's timetable
  const { data: timetableData, isLoading: timetableLoading } = useQuery({
    queryKey: ['myTimetable', todayDay, activeAcademicYear?.id],
    queryFn: () => academicsApi.getMyTimetable({
      day: todayDay,
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
    }),
  })

  // Classes needing attendance
  const { data: myClassesData } = useQuery({
    queryKey: ['myAttendanceClasses'],
    queryFn: () => attendanceApi.getMyAttendanceClasses(),
  })

  // Submissions needing grading
  const { data: submissionsData } = useQuery({
    queryKey: ['pendingSubmissions'],
    queryFn: () => lmsApi.getSubmissions({ status: 'SUBMITTED', page_size: 10 }),
  })

  // Active assignments
  const { data: assignmentsData } = useQuery({
    queryKey: ['activeAssignments'],
    queryFn: () => lmsApi.getAssignments({ status: 'PUBLISHED', page_size: 5 }),
  })

  // Notifications
  const { data: notificationsData } = useQuery({
    queryKey: ['myNotifications'],
    queryFn: () => notificationsApi.getMyNotifications({ limit: 5 }),
  })

  const timetable = timetableData?.data || []
  const myClasses = myClassesData?.data || []
  const submissions = submissionsData?.data?.results || submissionsData?.data || []
  const assignments = assignmentsData?.data?.results || assignmentsData?.data || []
  const notifications = notificationsData?.data?.results || notificationsData?.data || []

  const stats = [
    {
      label: 'Attendance to Mark',
      value: myClasses.length,
      color: 'bg-orange-100 text-orange-800',
      link: '/attendance/register?tab=manual',
    },
    {
      label: 'Pending Grading',
      value: submissions.length,
      color: 'bg-red-100 text-red-800',
      link: '/academics/assignments',
    },
    {
      label: 'Active Assignments',
      value: assignments.length,
      color: 'bg-blue-100 text-blue-800',
      link: '/academics/assignments',
    },
  ]

  const quickActions = [
    { to: '/attendance/register?tab=manual', label: 'Mark Attendance', desc: 'Take class attendance', bg: 'bg-orange-50 hover:bg-orange-100', icon: 'text-orange-600' },
    { to: '/academics/timetable', label: 'My Timetable', desc: 'View full timetable', bg: 'bg-blue-50 hover:bg-blue-100', icon: 'text-blue-600' },
    { to: '/academics/lesson-plans', label: 'Lesson Plans', desc: 'Create & manage plans', bg: 'bg-purple-50 hover:bg-purple-100', icon: 'text-purple-600' },
    { to: '/academics/assignments', label: 'Assignments', desc: 'Manage assignments', bg: 'bg-green-50 hover:bg-green-100', icon: 'text-green-600' },
    { to: '/academics/marks-entry', label: 'Marks Entry', desc: 'Enter exam marks', bg: 'bg-indigo-50 hover:bg-indigo-100', icon: 'text-indigo-600' },
    { to: '/notifications', label: 'Notifications', desc: 'View all notifications', bg: 'bg-gray-50 hover:bg-gray-100', icon: 'text-gray-600' },
  ]

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Teacher Dashboard</h1>
        <p className="text-sm sm:text-base text-gray-600">
          Welcome back, {[user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username}
        </p>
      </div>

      {/* Today's Timetable */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Today's Timetable</h2>
          <span className="text-sm text-gray-500">{todayDay}</span>
        </div>
        {timetableLoading ? (
          <div className="text-center py-6">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          </div>
        ) : timetable.length === 0 ? (
          <p className="text-gray-500 text-sm py-4 text-center">No classes scheduled today.</p>
        ) : (
          <>
            {/* Mobile card view */}
            <div className="sm:hidden space-y-2">
              {timetable.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between py-2 border-b border-gray-100">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{entry.subject_name || 'Free'}</p>
                    <p className="text-xs text-gray-500">{entry.class_name}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-600">{entry.slot_name}</p>
                    <p className="text-xs text-gray-400">{entry.slot_start_time?.slice(0, 5)} - {entry.slot_end_time?.slice(0, 5)}</p>
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Subject</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Class</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Room</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {timetable.map((entry) => (
                    <tr key={entry.id}>
                      <td className="px-4 py-3 text-sm text-gray-900">{entry.slot_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{entry.slot_start_time?.slice(0, 5)} - {entry.slot_end_time?.slice(0, 5)}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{entry.subject_name || 'Free'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{entry.class_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{entry.room || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {stats.map((stat) => (
          <Link key={stat.label} to={stat.link} className="card hover:shadow-md transition-shadow">
            <p className="text-sm text-gray-500">{stat.label}</p>
            <div className="flex items-center justify-between mt-1">
              <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
              <span className={`w-10 h-10 rounded-full ${stat.color} flex items-center justify-center text-sm font-semibold`}>
                {stat.value}
              </span>
            </div>
          </Link>
        ))}
      </div>

      {/* Submissions Needing Grading */}
      {submissions.length > 0 && (
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Submissions Needing Grading</h2>
            <Link to="/academics/assignments" className="text-sm text-primary-600 hover:text-primary-700">View all</Link>
          </div>
          <div className="space-y-2">
            {submissions.slice(0, 5).map((sub) => (
              <div key={sub.id} className="flex items-center justify-between py-2 border-b border-gray-100">
                <div>
                  <p className="text-sm font-medium text-gray-900">{sub.student_name || 'Student'}</p>
                  <p className="text-xs text-gray-500">{sub.assignment_title || 'Assignment'}</p>
                </div>
                <span className="text-xs text-gray-400">
                  {sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString() : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="card mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {quickActions.map((action) => (
            <Link key={action.to} to={action.to} className={`flex items-center p-4 rounded-lg transition-colors ${action.bg}`}>
              <div className={`w-8 h-8 rounded-full ${action.icon} bg-white flex items-center justify-center mr-3`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-gray-900 text-sm">{action.label}</p>
                <p className="text-xs text-gray-500">{action.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent Notifications */}
      {notifications.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Recent Notifications</h2>
            <Link to="/notifications" className="text-sm text-primary-600 hover:text-primary-700">View all</Link>
          </div>
          <div className="space-y-2">
            {notifications.map((n) => (
              <div key={n.id} className="flex items-start gap-3 py-2 border-b border-gray-100">
                <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${n.status === 'READ' ? 'bg-gray-300' : 'bg-primary-500'}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900">{n.title}</p>
                  <p className="text-xs text-gray-500 truncate">{n.body}</p>
                </div>
                <span className="text-xs text-gray-400 shrink-0">
                  {n.created_at ? new Date(n.created_at).toLocaleDateString() : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
