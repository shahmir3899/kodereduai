import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { notificationsApi } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import NotificationCarousel from './notifications/NotificationCarousel'
import { useNotificationActions } from './notifications/useNotificationActions'

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef(null)
  const { activeSchool } = useAuth()

  // Unread count
  const { data: countData } = useQuery({
    queryKey: ['notificationUnreadCount'],
    queryFn: () => notificationsApi.getUnreadCount(),
    refetchInterval: 30000, // Poll every 30s
    staleTime: 15000,
  })

  const { invalidate } = useNotificationActions()

  const markAllMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: invalidate,
  })

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const unread = countData?.data?.unread_count || 0

  // Bounce animation when new notifications arrive
  const [prevUnread, setPrevUnread] = useState(0)
  const [hasNewNotification, setHasNewNotification] = useState(false)

  useEffect(() => {
    if (unread > prevUnread && prevUnread > 0) {
      setHasNewNotification(true)
      const timer = setTimeout(() => setHasNewNotification(false), 3000)
      return () => clearTimeout(timer)
    }
    setPrevUnread(unread)
  }, [unread]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className={`relative p-2 rounded-lg hover:bg-gray-100 transition-colors ${
          hasNewNotification ? 'animate-bounce' : ''
        }`}
        title="Notifications across all schools"
      >
        <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[22rem] max-w-[calc(100vw-1.5rem)] bg-white rounded-lg shadow-xl border border-gray-200 z-50">
          <div className="flex items-center justify-between p-3 border-b border-gray-100">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Showing all schools{activeSchool?.name ? ` (current: ${activeSchool.name})` : ''}
              </p>
            </div>
            {unread > 0 && (
              <button
                onClick={() => markAllMutation.mutate()}
                className="text-xs text-primary-600 hover:text-primary-800"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="p-3">
            <NotificationCarousel allSchools showViewAll={false} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  )
}
