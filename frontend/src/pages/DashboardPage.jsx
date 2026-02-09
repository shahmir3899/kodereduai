import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { attendanceApi } from '../services/api'
import { Link } from 'react-router-dom'

export default function DashboardPage() {
  const { user } = useAuth()
  const today = new Date().toISOString().split('T')[0]

  // Fetch pending reviews
  const { data: pendingReviews } = useQuery({
    queryKey: ['pendingReviews'],
    queryFn: () => attendanceApi.getPendingReviews(),
  })

  // Fetch today's report
  const { data: dailyReport } = useQuery({
    queryKey: ['dailyReport', today],
    queryFn: () => attendanceApi.getDailyReport(today, user?.school_id),
    enabled: !!user?.school_id,
  })

  const stats = [
    {
      name: 'Pending Reviews',
      value: pendingReviews?.data?.length || 0,
      color: 'bg-yellow-100 text-yellow-800',
      link: '/attendance/review',
    },
    {
      name: "Today's Absent",
      value: dailyReport?.data?.absent_count || 0,
      color: 'bg-red-100 text-red-800',
    },
    {
      name: "Today's Present",
      value: dailyReport?.data?.present_count || 0,
      color: 'bg-green-100 text-green-800',
    },
    {
      name: 'Total Students',
      value: dailyReport?.data?.total_students || 0,
      color: 'bg-blue-100 text-blue-800',
    },
  ]

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm sm:text-base text-gray-600">Welcome back, {user?.username}</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <div key={stat.name} className="card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">{stat.name}</p>
                <p className="text-2xl sm:text-3xl font-bold text-gray-900 mt-1">{stat.value}</p>
              </div>
              <div className={`w-12 h-12 rounded-full ${stat.color} flex items-center justify-center`}>
                <span className="text-lg font-semibold">{stat.value}</span>
              </div>
            </div>
            {stat.link && (
              <Link
                to={stat.link}
                className="mt-3 text-sm text-primary-600 hover:text-primary-700 inline-flex items-center"
              >
                View all
                <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            )}
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="card mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link
            to="/attendance/upload"
            className="flex items-center p-4 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors"
          >
            <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <div className="ml-4">
              <p className="font-medium text-gray-900">Upload Attendance</p>
              <p className="text-sm text-gray-500">Upload register image</p>
            </div>
          </Link>

          <Link
            to="/attendance/review"
            className="flex items-center p-4 bg-yellow-50 rounded-lg hover:bg-yellow-100 transition-colors"
          >
            <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            <div className="ml-4">
              <p className="font-medium text-gray-900">Review Attendance</p>
              <p className="text-sm text-gray-500">Confirm AI results</p>
            </div>
          </Link>

          <Link
            to="/students"
            className="flex items-center p-4 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
          >
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            <div className="ml-4">
              <p className="font-medium text-gray-900">Manage Students</p>
              <p className="text-sm text-gray-500">View & edit students</p>
            </div>
          </Link>
        </div>
      </div>

      {/* Today's Absent List */}
      {dailyReport?.data?.absent_students?.length > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Today's Absent Students</h2>
          {/* Mobile card view */}
          <div className="sm:hidden space-y-2">
            {dailyReport.data.absent_students.slice(0, 10).map((record) => (
              <div key={record.id} className="flex items-center justify-between py-2 border-b border-gray-100">
                <div>
                  <p className="text-sm font-medium text-gray-900">{record.student_name}</p>
                  <p className="text-xs text-gray-500">{record.class_name}</p>
                </div>
                <span className="text-xs text-gray-500">Roll #{record.student_roll}</span>
              </div>
            ))}
          </div>
          {/* Desktop table view */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Student</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Class</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Roll No</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {dailyReport.data.absent_students.slice(0, 10).map((record) => (
                  <tr key={record.id}>
                    <td className="px-4 py-3 text-sm text-gray-900">{record.student_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{record.class_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{record.student_roll}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
