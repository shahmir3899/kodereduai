import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { hrApi, notificationsApi } from '../services/api'

export default function HRManagerDashboard() {
  const { user } = useAuth()

  const { data: statsData, isLoading } = useQuery({
    queryKey: ['hrDashboardStats'],
    queryFn: () => hrApi.getDashboardStats(),
  })

  const { data: notificationsData } = useQuery({
    queryKey: ['myNotifications'],
    queryFn: () => notificationsApi.getMyNotifications({ limit: 5 }),
  })

  const stats = statsData?.data || {}
  const notifications = notificationsData?.data?.results || notificationsData?.data || []

  const kpis = [
    { label: 'Total Staff', value: stats.total_staff || 0, sub: `${stats.active_staff || 0} active`, color: 'bg-blue-100 text-blue-800' },
    { label: 'On Leave Today', value: stats.on_leave_today || 0, color: 'bg-yellow-100 text-yellow-800' },
    { label: 'Pending Leave', value: stats.pending_leave_requests || 0, color: 'bg-red-100 text-red-800' },
    { label: 'Attendance Today', value: stats.present_today || 0, sub: `of ${stats.active_staff || 0}`, color: 'bg-green-100 text-green-800' },
  ]

  const quickActions = [
    { to: '/hr/staff', label: 'Staff Directory', desc: 'View all staff', bg: 'bg-blue-50 hover:bg-blue-100' },
    { to: '/hr/staff/new', label: 'Add Staff', desc: 'Create staff record', bg: 'bg-green-50 hover:bg-green-100' },
    { to: '/hr/leave', label: 'Leave Management', desc: 'Review requests', bg: 'bg-yellow-50 hover:bg-yellow-100' },
    { to: '/hr/payroll', label: 'Payroll', desc: 'Generate payslips', bg: 'bg-purple-50 hover:bg-purple-100' },
    { to: '/hr/attendance', label: 'Staff Attendance', desc: 'Mark attendance', bg: 'bg-orange-50 hover:bg-orange-100' },
    { to: '/hr', label: 'Full HR Dashboard', desc: 'Detailed analytics', bg: 'bg-indigo-50 hover:bg-indigo-100' },
  ]

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">HR Dashboard</h1>
        <p className="text-sm sm:text-base text-gray-600">
          Welcome back, {[user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username}
        </p>
      </div>

      {/* KPI Cards */}
      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="card">
              <p className="text-sm text-gray-500">{kpi.label}</p>
              <div className="flex items-center justify-between mt-1">
                <div>
                  <p className="text-2xl font-bold text-gray-900">{kpi.value}</p>
                  {kpi.sub && <p className="text-xs text-gray-400">{kpi.sub}</p>}
                </div>
                <span className={`w-10 h-10 rounded-full ${kpi.color} flex items-center justify-center text-sm font-semibold`}>
                  {kpi.value}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Quick Actions */}
      <div className="card mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {quickActions.map((action) => (
            <Link key={action.to} to={action.to} className={`flex items-center p-4 rounded-lg transition-colors ${action.bg}`}>
              <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center mr-3">
                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
