import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { parentsApi, sessionsApi } from '../../services/api'
import NotificationsFeed from '../../components/dashboard/NotificationsFeed'
import QuickActionGrid from '../../components/dashboard/QuickActionGrid'

export default function ParentDashboard() {
  const { user } = useAuth()

  const { data: childrenData, isLoading } = useQuery({
    queryKey: ['myChildren'],
    queryFn: () => parentsApi.getMyChildren(),
  })

  const children = childrenData?.data?.results || childrenData?.data || []

  const quickActions = [
    {
      label: 'Apply Leave',
      href: '/parent/leave',
      color: 'amber',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      label: 'Messages',
      href: '/parent/messages',
      color: 'blue',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      ),
    },
    {
      label: 'Leave History',
      href: '/parent/leave',
      color: 'green',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      ),
    },
    {
      label: 'My Profile',
      href: '/profile',
      color: 'purple',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
    },
  ]

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Parent Dashboard</h1>
        <p className="text-sm text-gray-600 mt-1">
          Welcome back, {user?.first_name || user?.username}
          {children.length > 0 && <span className="text-gray-400"> · {children.length} {children.length === 1 ? 'child' : 'children'} linked</span>}
        </p>
      </div>

      {/* Children Cards */}
      {children.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-gray-100 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </div>
          <h3 className="text-base font-medium text-gray-900 mb-1">No children linked</h3>
          <p className="text-sm text-gray-500">
            Contact the school administrator to link your children to your account.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {children.map((child) => (
            <ChildCard key={child.id} child={child} />
          ))}
        </div>
      )}

      {/* Two-column: Quick Actions + Notifications */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3">
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
            <h3 className="text-base font-semibold text-gray-900 mb-3">Quick Actions</h3>
            <QuickActionGrid actions={quickActions} />
          </div>
        </div>
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
            <h3 className="text-base font-semibold text-gray-900 mb-3">Notifications</h3>
            <NotificationsFeed limit={5} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Per-child card with overview data */
function ChildCard({ child }) {
  const today = new Date().toISOString().split('T')[0]

  const { data: overviewData, isLoading } = useQuery({
    queryKey: ['childOverview', child.id],
    queryFn: () => parentsApi.getChildOverview(child.id),
    staleTime: 5 * 60 * 1000,
  })

  const childClassId = child.class_id || child.class_obj || child.class_obj_id || null
  const { data: dayStatusRes } = useQuery({
    queryKey: ['childTodayDayStatus', child.id, today, childClassId],
    queryFn: () => sessionsApi.getCalendarDayStatus({
      date_from: today,
      date_to: today,
      class_id: childClassId || undefined,
    }),
    enabled: !!childClassId,
    staleTime: 5 * 60 * 1000,
  })

  const overview = overviewData?.data || {}
  const attendance = overview.attendance || {}
  const fees = overview.fees || overview.fee_summary || {}
  const recentExams = overview.recent_exams || overview.exam_results || []
  const dayStatus = dayStatusRes?.data?.days?.[today] || null
  const isOffDay = !!dayStatus?.is_off_day
  const offTypes = dayStatus?.off_day_types || []

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Child Header */}
      <div className="px-5 py-4 flex items-center gap-3 border-b border-gray-100">
        <div className="w-11 h-11 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
          <span className="text-lg font-bold text-primary-700">
            {child.name?.charAt(0)?.toUpperCase() || '?'}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-gray-900 truncate">{child.name}</h3>
          <p className="text-sm text-gray-500">
            {child.class_name || 'Class N/A'}
            {child.section ? ` - ${child.section}` : ''}
            {child.roll_number ? ` · Roll #${child.roll_number}` : ''}
          </p>
        </div>
        <Link
          to={`/parent/children/${child.id}`}
          className="text-sm text-primary-600 hover:text-primary-700 font-medium shrink-0"
        >
          View Details
        </Link>
      </div>

      {/* Stats Row */}
      <div className="px-5 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Attendance */}
        <div className="text-center p-2.5 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-500 mb-1">Attendance</p>
          {isLoading ? (
            <div className="h-5 bg-gray-200 rounded w-12 mx-auto animate-pulse" />
          ) : (
            <p className={`text-sm font-bold ${
              (attendance.rate ?? child.attendance_rate ?? null) === null ? 'text-gray-400' :
              (attendance.rate ?? child.attendance_rate) >= 75 ? 'text-green-600' :
              (attendance.rate ?? child.attendance_rate) >= 60 ? 'text-yellow-600' : 'text-red-600'
            }`}>
              {(attendance.rate ?? child.attendance_rate) != null
                ? `${attendance.rate ?? child.attendance_rate}%`
                : 'N/A'}
            </p>
          )}
        </div>

        {/* Fee Status */}
        <div className="text-center p-2.5 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-500 mb-1">Fees Due</p>
          {isLoading ? (
            <div className="h-5 bg-gray-200 rounded w-16 mx-auto animate-pulse" />
          ) : (
            <p className={`text-sm font-bold ${
              (fees.total_due ?? fees.outstanding ?? child.fee_outstanding ?? 0) > 0
                ? 'text-red-600' : 'text-green-600'
            }`}>
              {(fees.total_due ?? fees.outstanding ?? child.fee_outstanding) != null
                ? `PKR ${Number(fees.total_due ?? fees.outstanding ?? child.fee_outstanding ?? 0).toLocaleString()}`
                : child.fee_status || 'N/A'}
            </p>
          )}
        </div>

        {/* Last Exam */}
        <div className="text-center p-2.5 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-500 mb-1">Last Exam</p>
          {isLoading ? (
            <div className="h-5 bg-gray-200 rounded w-10 mx-auto animate-pulse" />
          ) : (() => {
            const lastExam = recentExams[0]
            const pct = lastExam?.percentage ?? lastExam?.total_obtained_percentage ?? child.last_exam_score
            return (
              <p className={`text-sm font-bold ${
                pct == null ? 'text-gray-400' :
                pct >= 60 ? 'text-green-600' :
                pct >= 40 ? 'text-yellow-600' : 'text-red-600'
              }`}>
                {pct != null ? `${Math.round(pct)}%` : 'N/A'}
              </p>
            )
          })()}
        </div>

        {/* Today's Status */}
        <div className="text-center p-2.5 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-500 mb-1">Today</p>
          {isLoading ? (
            <div className="h-5 bg-gray-200 rounded w-14 mx-auto animate-pulse" />
          ) : (() => {
            if (isOffDay) {
              return (
                <p className="text-sm font-bold text-gray-700" title={offTypes.length ? offTypes.join(', ') : undefined}>
                  OFF
                </p>
              )
            }
            const todayStatus = attendance.today ?? overview.today_attendance
            if (!todayStatus) return <p className="text-sm font-bold text-gray-400">—</p>
            const statusColors = {
              PRESENT: 'text-green-600',
              ABSENT: 'text-red-600',
              LATE: 'text-amber-600',
              LEAVE: 'text-blue-600',
            }
            return (
              <p className={`text-sm font-bold ${statusColors[todayStatus] || 'text-gray-600'}`}>
                {todayStatus.charAt(0) + todayStatus.slice(1).toLowerCase()}
              </p>
            )
          })()}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="px-5 py-3 border-t border-gray-100 flex flex-wrap gap-2">
        <Link
          to={`/parent/children/${child.id}/attendance`}
          className="text-xs font-medium text-gray-600 hover:text-primary-600 bg-gray-50 hover:bg-primary-50 px-3 py-1.5 rounded-md transition-colors"
        >
          Attendance
        </Link>
        <Link
          to={`/parent/children/${child.id}/fees`}
          className="text-xs font-medium text-gray-600 hover:text-primary-600 bg-gray-50 hover:bg-primary-50 px-3 py-1.5 rounded-md transition-colors"
        >
          Fees
        </Link>
        <Link
          to={`/parent/children/${child.id}/results`}
          className="text-xs font-medium text-gray-600 hover:text-primary-600 bg-gray-50 hover:bg-primary-50 px-3 py-1.5 rounded-md transition-colors"
        >
          Results
        </Link>
        <Link
          to={`/parent/children/${child.id}/timetable`}
          className="text-xs font-medium text-gray-600 hover:text-primary-600 bg-gray-50 hover:bg-primary-50 px-3 py-1.5 rounded-md transition-colors"
        >
          Timetable
        </Link>
        <Link
          to="/parent/leave"
          className="text-xs font-medium text-gray-600 hover:text-amber-600 bg-gray-50 hover:bg-amber-50 px-3 py-1.5 rounded-md transition-colors"
        >
          Apply Leave
        </Link>
      </div>
    </div>
  )
}
