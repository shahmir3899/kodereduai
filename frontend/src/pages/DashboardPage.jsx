import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { useAcademicYear } from '../contexts/AcademicYearContext'
import { attendanceApi, financeApi } from '../services/api'
import { Link } from 'react-router-dom'
import SchoolCompletionWidget from '../components/SchoolCompletionWidget'
import SessionHealthWidget from '../components/SessionHealthWidget'
import AttendanceRiskWidget from '../components/AttendanceRiskWidget'

export default function DashboardPage({ variant }) {
  const { user, activeSchool } = useAuth()
  const { activeAcademicYear, currentTerm, hasAcademicYear, loading: academicYearLoading } = useAcademicYear()
  const today = new Date().toISOString().split('T')[0]

  // Fetch pending reviews
  const { data: pendingReviews } = useQuery({
    queryKey: ['pendingReviews', activeAcademicYear?.id],
    queryFn: () => attendanceApi.getPendingReviews({
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
    }),
  })

  // Fetch today's report
  const { data: dailyReport } = useQuery({
    queryKey: ['dailyReport', today, activeSchool?.id, activeAcademicYear?.id],
    queryFn: () => attendanceApi.getDailyReport(today, activeSchool?.id, activeAcademicYear?.id),
    enabled: !!activeSchool?.id,
  })

  // Fetch finance summary for current month
  const currentMonth = new Date().getMonth() + 1
  const currentYear = new Date().getFullYear()
  const { data: financeSummary } = useQuery({
    queryKey: ['financeSummaryDashboard', currentMonth, currentYear, activeAcademicYear?.id],
    queryFn: () => financeApi.getMonthlySummary({
      month: currentMonth, year: currentYear,
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
    }),
    enabled: !!activeSchool?.id,
  })

  const stats = [
    {
      name: 'Pending Reviews',
      value: pendingReviews?.data?.length || 0,
      color: 'bg-yellow-100 text-yellow-800',
      link: '/attendance?tab=review',
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
        <p className="text-sm sm:text-base text-gray-600">Welcome back, {[user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username}</p>
      </div>

      {/* Academic Session Banner */}
      {academicYearLoading ? null : hasAcademicYear ? (
        <div className="mb-6 flex items-center gap-3 px-4 py-3 bg-sky-50 border border-sky-200 rounded-lg">
          <svg className="w-5 h-5 text-sky-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sky-800">
              Session: {activeAcademicYear.name}
              {currentTerm && <span className="text-sky-600 ml-2">| {currentTerm.name}</span>}
            </p>
            <p className="text-xs text-sky-600 mt-0.5">
              {activeAcademicYear.start_date} to {activeAcademicYear.end_date}
            </p>
          </div>
          <Link to="/academics/sessions" className="text-xs text-sky-700 hover:text-sky-800 font-medium shrink-0">
            Manage
          </Link>
        </div>
      ) : (
        <div className="mb-6 flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
          <svg className="w-5 h-5 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800">No Academic Session Set</p>
            <p className="text-xs text-amber-600">Create an academic year and set it as current to enable session-aware features.</p>
          </div>
          <Link to="/academics/sessions" className="btn-primary text-xs px-3 py-1.5">
            Setup Now
          </Link>
        </div>
      )}

      {/* School Setup Progress */}
      <SchoolCompletionWidget />

      {/* Session Health Widget */}
      <SessionHealthWidget />

      {/* Attendance Risk Monitor */}
      <AttendanceRiskWidget />

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
          {variant === 'principal' ? (
            <>
              <Link
                to="/academics/lesson-plans"
                className="flex items-center p-4 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors"
              >
                <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <div className="ml-4">
                  <p className="font-medium text-gray-900">Lesson Plans</p>
                  <p className="text-sm text-gray-500">Review lesson plans</p>
                </div>
              </Link>

              <Link
                to="/academics/exams"
                className="flex items-center p-4 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
              >
                <svg className="w-8 h-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <div className="ml-4">
                  <p className="font-medium text-gray-900">Examinations</p>
                  <p className="text-sm text-gray-500">Manage exams & results</p>
                </div>
              </Link>

              <Link
                to="/classes"
                className="flex items-center p-4 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
              >
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                <div className="ml-4">
                  <p className="font-medium text-gray-900">Class Management</p>
                  <p className="text-sm text-gray-500">View & manage classes</p>
                </div>
              </Link>
            </>
          ) : (
            <>
              <Link
                to="/attendance"
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
                to="/attendance?tab=review"
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
            </>
          )}
        </div>
      </div>

      {/* Finance Overview */}
      {financeSummary?.data && (
        <div className="card mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Finance Overview</h2>
            <Link to="/finance" className="text-sm text-primary-600 hover:text-primary-700">View Details</Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-green-50 rounded-lg">
              <p className="text-sm text-green-700">Fee Collected</p>
              <p className="text-xl font-bold text-green-800">
                {Number(financeSummary.data.total_collected || 0).toLocaleString()}
              </p>
            </div>
            <div className="p-4 bg-orange-50 rounded-lg">
              <p className="text-sm text-orange-700">Fee Pending</p>
              <p className="text-xl font-bold text-orange-800">
                {Number(financeSummary.data.total_pending || 0).toLocaleString()}
              </p>
            </div>
            <div className="p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-700">Collection Rate</p>
              <p className="text-xl font-bold text-blue-800">
                {financeSummary.data.total_due > 0
                  ? Math.round((financeSummary.data.total_collected / financeSummary.data.total_due) * 100)
                  : 0}%
              </p>
            </div>
          </div>
        </div>
      )}

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
