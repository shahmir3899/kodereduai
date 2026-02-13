import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { parentsApi, notificationsApi } from '../../services/api'

export default function ParentDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const { data: childrenData, isLoading: childrenLoading } = useQuery({
    queryKey: ['myChildren'],
    queryFn: () => parentsApi.getMyChildren(),
  })

  const { data: notificationsData } = useQuery({
    queryKey: ['parentNotifications'],
    queryFn: () => notificationsApi.getMyNotifications({ limit: 5 }),
  })

  const children = childrenData?.data?.results || childrenData?.data || []
  const notifications = notificationsData?.data?.results || notificationsData?.data || []

  if (childrenLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Parent Dashboard</h1>
        <p className="text-sm sm:text-base text-gray-600 mt-1">
          Welcome back, {user?.first_name || user?.username}
        </p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Link
          to="/parent/leave"
          className="flex flex-col items-center gap-2 p-4 bg-white rounded-xl border border-gray-200 hover:border-primary-300 hover:shadow-sm transition-all"
        >
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <span className="text-xs font-medium text-gray-700">Apply Leave</span>
        </Link>
        <Link
          to="/parent/messages"
          className="flex flex-col items-center gap-2 p-4 bg-white rounded-xl border border-gray-200 hover:border-primary-300 hover:shadow-sm transition-all"
        >
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>
          <span className="text-xs font-medium text-gray-700">Messages</span>
        </Link>
        <Link
          to="/parent/leave"
          className="flex flex-col items-center gap-2 p-4 bg-white rounded-xl border border-gray-200 hover:border-primary-300 hover:shadow-sm transition-all"
        >
          <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <span className="text-xs font-medium text-gray-700">Leave History</span>
        </Link>
        <Link
          to="/profile"
          className="flex flex-col items-center gap-2 p-4 bg-white rounded-xl border border-gray-200 hover:border-primary-300 hover:shadow-sm transition-all"
        >
          <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <span className="text-xs font-medium text-gray-700">My Profile</span>
        </Link>
      </div>

      {/* Children Cards */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">My Children</h2>

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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {children.map((child) => (
              <button
                key={child.id}
                onClick={() => navigate(`/parent/children/${child.id}`)}
                className="bg-white rounded-xl border border-gray-200 p-5 text-left hover:border-primary-300 hover:shadow-md transition-all group"
              >
                {/* Child Header */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0 group-hover:bg-primary-200 transition-colors">
                    <span className="text-lg font-bold text-primary-700">
                      {child.name?.charAt(0)?.toUpperCase() || '?'}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-semibold text-gray-900 truncate">{child.name}</h3>
                    <p className="text-sm text-gray-500">
                      {child.class_name || 'Class N/A'}
                      {child.section ? ` - ${child.section}` : ''}
                      {child.roll_number ? ` | Roll #${child.roll_number}` : ''}
                    </p>
                  </div>
                  <svg className="w-5 h-5 text-gray-400 group-hover:text-primary-500 flex-shrink-0 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>

                {/* Summary Stats */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center p-2 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500">Attendance</p>
                    <p className={`text-sm font-bold mt-0.5 ${
                      (child.attendance_rate ?? null) === null ? 'text-gray-400' :
                      child.attendance_rate >= 75 ? 'text-green-600' :
                      child.attendance_rate >= 60 ? 'text-yellow-600' : 'text-red-600'
                    }`}>
                      {child.attendance_rate != null ? `${child.attendance_rate}%` : 'N/A'}
                    </p>
                  </div>
                  <div className="text-center p-2 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500">Fee Status</p>
                    <p className={`text-sm font-bold mt-0.5 ${
                      child.fee_status === 'PAID' ? 'text-green-600' :
                      child.fee_status === 'PARTIAL' ? 'text-yellow-600' :
                      child.fee_status === 'UNPAID' ? 'text-red-600' : 'text-gray-400'
                    }`}>
                      {child.fee_status || 'N/A'}
                    </p>
                  </div>
                  <div className="text-center p-2 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500">Last Exam</p>
                    <p className={`text-sm font-bold mt-0.5 ${
                      (child.last_exam_score ?? null) === null ? 'text-gray-400' :
                      child.last_exam_score >= 60 ? 'text-green-600' :
                      child.last_exam_score >= 40 ? 'text-yellow-600' : 'text-red-600'
                    }`}>
                      {child.last_exam_score != null ? `${child.last_exam_score}%` : 'N/A'}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Recent Notifications */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Recent Notifications</h2>
          <Link to="/parent/messages" className="text-sm text-primary-600 hover:text-primary-700 font-medium">
            View All
          </Link>
        </div>

        {notifications.length === 0 ? (
          <div className="p-8 text-center">
            <svg className="w-10 h-10 mx-auto text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <p className="text-sm text-gray-500">No notifications yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {notifications.map((notif) => (
              <div
                key={notif.id}
                className={`px-5 py-3 flex items-start gap-3 ${!notif.is_read ? 'bg-primary-50/50' : ''}`}
              >
                <div className={`w-2 h-2 mt-2 rounded-full flex-shrink-0 ${!notif.is_read ? 'bg-primary-500' : 'bg-transparent'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 font-medium truncate">{notif.title || notif.subject || 'Notification'}</p>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{notif.message || notif.body || ''}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {notif.created_at ? new Date(notif.created_at).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                    }) : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
