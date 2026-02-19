import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { notificationsApi } from '../../services/api'

export default function StaffDashboard() {
  const { user, isModuleEnabled } = useAuth()

  const { data: notificationsData, isLoading } = useQuery({
    queryKey: ['myNotifications'],
    queryFn: () => notificationsApi.getMyNotifications({ limit: 10 }),
  })

  const notifications = notificationsData?.data?.results || notificationsData?.data || []

  const quickLinks = [
    { to: '/profile', label: 'My Profile', desc: 'View and edit your profile', bg: 'bg-blue-50 hover:bg-blue-100' },
    { to: '/notifications', label: 'Notifications', desc: 'View all notifications', bg: 'bg-gray-50 hover:bg-gray-100' },
    ...(isModuleEnabled('library') ? [{ to: '/library', label: 'Library', desc: 'Browse library catalog', bg: 'bg-green-50 hover:bg-green-100' }] : []),
    ...(isModuleEnabled('inventory') ? [{ to: '/inventory', label: 'Inventory', desc: 'View inventory items', bg: 'bg-orange-50 hover:bg-orange-100' }] : []),
  ]

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Dashboard</h1>
          <span className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded-full font-medium">Staff</span>
        </div>
        <p className="text-sm sm:text-base text-gray-600">
          Welcome back, {[user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username}
        </p>
      </div>

      {/* Notifications & Announcements */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Notifications & Announcements</h2>
          <Link to="/notifications" className="text-sm text-primary-600 hover:text-primary-700">View all</Link>
        </div>
        {isLoading ? (
          <div className="text-center py-6">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          </div>
        ) : notifications.length === 0 ? (
          <p className="text-gray-500 text-sm py-4 text-center">No notifications yet.</p>
        ) : (
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
        )}
      </div>

      {/* Quick Links */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Links</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {quickLinks.map((link) => (
            <Link key={link.to} to={link.to} className={`flex items-center p-4 rounded-lg transition-colors ${link.bg}`}>
              <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center mr-3">
                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-gray-900 text-sm">{link.label}</p>
                <p className="text-xs text-gray-500">{link.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
