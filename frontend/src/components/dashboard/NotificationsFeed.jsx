import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { notificationsApi } from '../../services/api'

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

/**
 * @param {object} props
 * @param {number} [props.limit=5]
 */
export default function NotificationsFeed({ limit = 5 }) {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboardNotifications', limit],
    queryFn: () => notificationsApi.getMyNotifications({ limit }),
    staleTime: 2 * 60 * 1000,
  })

  const notifications = data?.data?.results || data?.data || []

  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex gap-2.5">
            <div className="w-2 h-2 rounded-full bg-gray-200 mt-1.5 shrink-0" />
            <div className="flex-1">
              <div className="h-3.5 bg-gray-200 rounded w-3/4 mb-1.5" />
              <div className="h-3 bg-gray-100 rounded w-1/3" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (notifications.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-4">No notifications</p>
  }

  return (
    <div>
      <div className="space-y-1">
        {notifications.slice(0, limit).map((n) => (
          <div
            key={n.id}
            className={`flex gap-2.5 px-2 py-2 rounded-lg ${!n.is_read ? 'bg-sky-50/50' : 'hover:bg-gray-50'} transition-colors`}
          >
            <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${!n.is_read ? 'bg-sky-500' : 'bg-gray-300'}`} />
            <div className="flex-1 min-w-0">
              <p className={`text-sm leading-snug ${!n.is_read ? 'text-gray-900 font-medium' : 'text-gray-600'}`}>
                {n.title || n.message || n.event_type}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{timeAgo(n.created_at)}</p>
            </div>
          </div>
        ))}
      </div>
      <Link
        to="/notifications"
        className="block text-center text-xs text-sky-600 hover:text-sky-700 font-medium mt-3 pt-2 border-t border-gray-100"
      >
        View All Notifications
      </Link>
    </div>
  )
}
