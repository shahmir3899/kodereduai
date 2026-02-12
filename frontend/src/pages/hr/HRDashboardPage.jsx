import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { hrApi } from '../../services/api'

const statusColors = {
  ACTIVE: 'bg-green-500',
  ON_LEAVE: 'bg-yellow-500',
  TERMINATED: 'bg-red-500',
  RESIGNED: 'bg-gray-500',
  RETIRED: 'bg-blue-500',
}

const typeColors = {
  FULL_TIME: 'bg-blue-500',
  PART_TIME: 'bg-purple-500',
  CONTRACT: 'bg-orange-500',
  TEMPORARY: 'bg-yellow-500',
  INTERN: 'bg-teal-500',
}

export default function HRDashboardPage() {
  const { data: statsData, isLoading } = useQuery({
    queryKey: ['hrDashboardStats'],
    queryFn: () => hrApi.getDashboardStats(),
  })

  const stats = statsData?.data || {}
  const departmentBreakdown = stats.department_breakdown || []
  const statusBreakdown = stats.status_breakdown || []
  const typeBreakdown = stats.type_breakdown || []

  const maxDeptCount = Math.max(...departmentBreakdown.map(d => d.count), 1)

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">HR Dashboard</h1>
          <p className="text-sm text-gray-600">Staff overview and quick actions</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="card">
          <p className="text-xs text-gray-500 mb-1">Total Staff</p>
          <p className="text-2xl font-bold text-gray-900">{stats.total_staff || 0}</p>
        </div>
        <div className="card">
          <p className="text-xs text-gray-500 mb-1">Active Staff</p>
          <p className="text-2xl font-bold text-green-700">{stats.active_staff || 0}</p>
        </div>
        <div className="card">
          <p className="text-xs text-gray-500 mb-1">Departments</p>
          <p className="text-2xl font-bold text-blue-700">{stats.total_departments || 0}</p>
        </div>
        <div className="card">
          <p className="text-xs text-gray-500 mb-1">Recent Joiners (30d)</p>
          <p className="text-2xl font-bold text-purple-700">{stats.recent_joiners || 0}</p>
        </div>
        <div className="card">
          <p className="text-xs text-gray-500 mb-1">Payroll This Month</p>
          <p className="text-2xl font-bold text-gray-900">
            {parseFloat(stats.total_payroll_this_month || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </p>
          {(stats.pending_payroll_approvals || 0) > 0 && (
            <p className="text-xs text-yellow-600 mt-1">{stats.pending_payroll_approvals} pending approval</p>
          )}
        </div>
        <div className="card">
          <p className="text-xs text-gray-500 mb-1">Leave Status</p>
          <p className="text-2xl font-bold text-orange-600">{stats.staff_on_leave_today || 0} <span className="text-sm font-normal text-gray-500">on leave today</span></p>
          {(stats.pending_leave_applications || 0) > 0 && (
            <p className="text-xs text-yellow-600 mt-1">{stats.pending_leave_applications} pending request{stats.pending_leave_applications !== 1 ? 's' : ''}</p>
          )}
        </div>
        <div className="card">
          <p className="text-xs text-gray-500 mb-1">Attendance Today</p>
          <p className="text-2xl font-bold text-teal-700">
            {stats.attendance_present_today || 0}
            <span className="text-sm font-normal text-gray-500"> / {stats.active_staff || 0} present</span>
          </p>
          {(stats.attendance_marked_today || 0) < (stats.active_staff || 0) && (
            <p className="text-xs text-yellow-600 mt-1">{(stats.active_staff || 0) - (stats.attendance_marked_today || 0)} unmarked</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Department Breakdown */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Staff by Department</h2>
            <Link to="/hr/departments" className="text-xs text-primary-600 hover:underline">
              Manage
            </Link>
          </div>

          {departmentBreakdown.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No departments created yet</p>
          ) : (
            <div className="space-y-3">
              {departmentBreakdown.map((dept) => {
                const pct = (dept.count / maxDeptCount) * 100
                return (
                  <div key={dept.department__id}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-700">{dept.department__name}</span>
                      <span className="text-sm font-semibold text-gray-900">{dept.count}</span>
                    </div>
                    <div className="bg-gray-200 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Employment Status & Type */}
        <div className="space-y-6">
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">By Employment Status</h2>
            {statusBreakdown.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No data</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {statusBreakdown.map((item) => (
                  <div key={item.employment_status} className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${statusColors[item.employment_status] || 'bg-gray-400'}`} />
                    <span className="text-sm text-gray-600">{item.employment_status}</span>
                    <span className="text-sm font-semibold text-gray-900">{item.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">By Employment Type</h2>
            {typeBreakdown.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">No data</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {typeBreakdown.map((item) => (
                  <div key={item.employment_type} className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${typeColors[item.employment_type] || 'bg-gray-400'}`} />
                    <span className="text-sm text-gray-600">{item.employment_type}</span>
                    <span className="text-sm font-semibold text-gray-900">{item.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Link
          to="/hr/staff/new"
          className="card flex items-center justify-center py-3 hover:bg-gray-50 transition-colors"
        >
          <span className="text-sm font-medium text-primary-700">+ Add Staff Member</span>
        </Link>
        <Link
          to="/hr/departments"
          className="card flex items-center justify-center py-3 hover:bg-gray-50 transition-colors"
        >
          <span className="text-sm font-medium text-primary-700">Manage Departments</span>
        </Link>
        <Link
          to="/hr/staff"
          className="card flex items-center justify-center py-3 hover:bg-gray-50 transition-colors"
        >
          <span className="text-sm font-medium text-primary-700">View Staff Directory</span>
        </Link>
        <Link
          to="/hr/salary"
          className="card flex items-center justify-center py-3 hover:bg-gray-50 transition-colors"
        >
          <span className="text-sm font-medium text-primary-700">Manage Salaries</span>
        </Link>
        <Link
          to="/hr/payroll"
          className="card flex items-center justify-center py-3 hover:bg-gray-50 transition-colors"
        >
          <span className="text-sm font-medium text-primary-700">Run Payroll</span>
        </Link>
        <Link
          to="/hr/leave"
          className="card flex items-center justify-center py-3 hover:bg-gray-50 transition-colors"
        >
          <span className="text-sm font-medium text-primary-700">Leave Management</span>
        </Link>
        <Link
          to="/hr/attendance"
          className="card flex items-center justify-center py-3 hover:bg-gray-50 transition-colors"
        >
          <span className="text-sm font-medium text-primary-700">Staff Attendance</span>
        </Link>
        <Link
          to="/hr/appraisals"
          className="card flex items-center justify-center py-3 hover:bg-gray-50 transition-colors"
        >
          <span className="text-sm font-medium text-primary-700">Performance Reviews</span>
        </Link>
        <Link
          to="/hr/documents"
          className="card flex items-center justify-center py-3 hover:bg-gray-50 transition-colors"
        >
          <span className="text-sm font-medium text-primary-700">Staff Documents</span>
        </Link>
      </div>
    </div>
  )
}
