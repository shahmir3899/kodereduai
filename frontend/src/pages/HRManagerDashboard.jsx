import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { hrApi, sessionsApi } from '../services/api'
import { useToast } from '../components/Toast'
import StatCard from '../components/dashboard/StatCard'
import QuickActionGrid from '../components/dashboard/QuickActionGrid'
import NotificationsFeed from '../components/dashboard/NotificationsFeed'

// ─── Icons ──────────────────────────────────────────────────────────────────────
const icons = {
  staff: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  leave: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  pending: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  present: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  payroll: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  payslip: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
    </svg>
  ),
  addStaff: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
    </svg>
  ),
  attendance: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  appraisal: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
    </svg>
  ),
  hrDash: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
}

export default function HRManagerDashboard() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const queryClient = useQueryClient()
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()
  const monthStart = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`
  const today = now.toISOString().split('T')[0]

  // ─── Queries ──────────────────────────────────────────────────────────────────

  const { data: statsRes, isLoading: loadingStats } = useQuery({
    queryKey: ['hrDashboardStats'],
    queryFn: () => hrApi.getDashboardStats(),
  })
  const stats = statsRes?.data || {}

  const { data: payrollRes, isLoading: loadingPayroll } = useQuery({
    queryKey: ['payrollSummary', currentMonth, currentYear],
    queryFn: () => hrApi.getPayrollSummary({ month: currentMonth, year: currentYear }),
  })
  const payroll = payrollRes?.data || {}

  const { data: pendingLeavesRes } = useQuery({
    queryKey: ['pendingLeaves'],
    queryFn: () => hrApi.getLeaveApplications({ status: 'PENDING', page_size: 5 }),
  })
  const pendingLeaves = pendingLeavesRes?.data?.results || pendingLeavesRes?.data || []

  const { data: attendanceSummaryRes } = useQuery({
    queryKey: ['staffAttendanceSummary', monthStart, today],
    queryFn: () => hrApi.getAttendanceSummary({ date_from: monthStart, date_to: today }),
  })
  const attendanceSummary = attendanceSummaryRes?.data || []

  const { data: dayStatusRes } = useQuery({
    queryKey: ['hrManagerDayStatus', today],
    queryFn: () => sessionsApi.getCalendarDayStatus({ date_from: today, date_to: today }),
  })

  // ─── Leave Approve/Reject ─────────────────────────────────────────────────────

  const approveMut = useMutation({
    mutationFn: (id) => hrApi.approveLeave(id, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingLeaves'] })
      queryClient.invalidateQueries({ queryKey: ['hrDashboardStats'] })
      addToast('Leave approved', 'success')
    },
    onError: () => addToast('Failed to approve', 'error'),
  })

  const rejectMut = useMutation({
    mutationFn: (id) => hrApi.rejectLeave(id, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingLeaves'] })
      queryClient.invalidateQueries({ queryKey: ['hrDashboardStats'] })
      addToast('Leave rejected', 'success')
    },
    onError: () => addToast('Failed to reject', 'error'),
  })

  // ─── Computed ─────────────────────────────────────────────────────────────────

  const activeStaff = stats.active_staff || 0
  const presentToday = stats.present_today || 0
  const todayStatus = dayStatusRes?.data?.days?.[today] || null
  const isOffDay = !!todayStatus?.is_off_day
  const offTypes = todayStatus?.off_day_types || []
  const presentPct = !isOffDay && activeStaff > 0 ? Math.round((presentToday / activeStaff) * 100) : null
  const pendingLeaveCount = stats.pending_leave_requests || 0
  const onLeave = stats.on_leave_count || stats.on_leave_today || 0

  const payrollNet = Number(payroll.total_net || 0)
  const payrollStatus = payroll.status_counts || {}
  const hasDraftPayslips = (payrollStatus.DRAFT || 0) > 0

  const deptBreakdown = stats.department_breakdown || []

  // Top absentees from attendance summary
  const topAbsentees = Array.isArray(attendanceSummary)
    ? [...attendanceSummary]
        .filter(s => (s.absent || 0) > 0)
        .sort((a, b) => (b.absent || 0) - (a.absent || 0))
        .slice(0, 5)
    : []

  // ─── Quick Actions ──────────────────────────────────────────────────────────

  const quickActions = [
    { label: 'Add Staff', href: '/hr/staff', icon: icons.addStaff },
    { label: 'Mark Attendance', href: '/hr/attendance', icon: icons.attendance },
    { label: 'Leave Management', href: '/hr/leave', icon: icons.leave },
    { label: 'Process Payroll', href: '/hr/payroll', icon: icons.payroll },
    { label: 'Appraisals', href: '/hr/appraisals', icon: icons.appraisal },
    { label: 'HR Dashboard', href: '/hr', icon: icons.hrDash },
  ]

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">HR Dashboard</h1>
        <p className="text-sm text-gray-500">
          Welcome back, {[user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username}
        </p>
      </div>

      {/* KPI Stats — 2 rows of 3 */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        <StatCard
          label="Total Staff"
          value={stats.total_staff || 0}
          subtitle={`${activeStaff} active`}
          icon={icons.staff}
          color="blue"
          href="/hr/staff"
          loading={loadingStats}
        />
        <StatCard
          label="Present Today"
          value={isOffDay ? 'N/A' : presentPct != null ? `${presentPct}%` : '—'}
          subtitle={isOffDay ? `OFF day${offTypes.length ? ` (${offTypes.join(', ')})` : ''}` : `${presentToday} of ${activeStaff}`}
          icon={icons.present}
          color={isOffDay ? 'gray' : 'green'}
          href="/hr/attendance"
          loading={loadingStats}
        />
        <StatCard
          label="On Leave Today"
          value={onLeave}
          icon={icons.leave}
          color={onLeave > 0 ? 'amber' : 'green'}
          loading={loadingStats}
        />
        <StatCard
          label="Pending Leave Requests"
          value={pendingLeaveCount}
          subtitle={pendingLeaveCount > 0 ? 'action needed' : 'all clear'}
          icon={icons.pending}
          color={pendingLeaveCount > 0 ? 'red' : 'green'}
          href="/hr/leave"
          loading={loadingStats}
        />
        <StatCard
          label="Payroll This Month"
          value={payrollNet > 0 ? `Rs. ${payrollNet.toLocaleString()}` : '—'}
          subtitle={payrollNet > 0 ? `${payroll.total_payslips || 0} payslips` : 'not generated'}
          icon={icons.payroll}
          color="purple"
          href="/hr/payroll"
          loading={loadingPayroll}
        />
        <StatCard
          label="Payslip Status"
          value={hasDraftPayslips ? `${payrollStatus.DRAFT} draft` : payrollStatus.PAID ? `${payrollStatus.PAID} paid` : '—'}
          subtitle={payrollStatus.APPROVED ? `${payrollStatus.APPROVED} approved` : undefined}
          icon={icons.payslip}
          color={hasDraftPayslips ? 'amber' : 'green'}
          href="/hr/payroll"
          loading={loadingPayroll}
        />
      </div>

      {/* Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Left Column */}
        <div className="lg:col-span-3 space-y-6">

          {/* Department Breakdown */}
          {deptBreakdown.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900">Department Breakdown</h2>
                <Link to="/hr/staff" className="text-xs text-sky-600 hover:text-sky-700 font-medium">View Staff</Link>
              </div>
              <div className="space-y-2">
                {deptBreakdown.map((dept, i) => {
                  const count = dept.count || dept.staff_count || 0
                  const maxCount = Math.max(...deptBreakdown.map(d => d.count || d.staff_count || 0), 1)
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-sm text-gray-700 w-32 sm:w-40 truncate">{dept.name || dept.department || dept.department__name || `Dept ${i + 1}`}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2 min-w-0">
                        <div
                          className="bg-sky-500 h-2 rounded-full transition-all duration-500"
                          style={{ width: `${(count / maxCount) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium text-gray-900 w-8 text-right tabular-nums">{count}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Pending Leave Requests */}
          {pendingLeaves.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900">Pending Leave Requests</h2>
                <Link to="/hr/leave" className="text-xs text-sky-600 hover:text-sky-700 font-medium">View All</Link>
              </div>
              <div className="space-y-2.5">
                {pendingLeaves.map(leave => (
                  <div key={leave.id} className="flex items-start justify-between gap-3 p-3 bg-amber-50/50 rounded-lg border border-amber-100">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800">{leave.staff_member_name || leave.staff_name || 'Staff'}</p>
                      <p className="text-xs text-gray-500">
                        {leave.leave_type_name || leave.leave_type || 'Leave'}
                        {leave.start_date && leave.end_date && ` — ${new Date(leave.start_date).toLocaleDateString()} to ${new Date(leave.end_date).toLocaleDateString()}`}
                      </p>
                      {leave.reason && <p className="text-xs text-gray-400 mt-0.5 truncate">{leave.reason}</p>}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => approveMut.mutate(leave.id)}
                        disabled={approveMut.isPending}
                        className="px-2.5 py-1 text-xs font-medium text-green-700 bg-green-100 hover:bg-green-200 rounded-md transition-colors"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => rejectMut.mutate(leave.id)}
                        disabled={rejectMut.isPending}
                        className="px-2.5 py-1 text-xs font-medium text-red-700 bg-red-100 hover:bg-red-200 rounded-md transition-colors"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Staff Attendance — Top Absentees */}
          {topAbsentees.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900">Most Absences This Month</h2>
                <Link to="/hr/attendance" className="text-xs text-sky-600 hover:text-sky-700 font-medium">View All</Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 text-xs font-medium text-gray-500">Staff Member</th>
                      <th className="text-right py-2 text-xs font-medium text-gray-500">Present</th>
                      <th className="text-right py-2 text-xs font-medium text-gray-500">Absent</th>
                      <th className="text-right py-2 text-xs font-medium text-gray-500">Leave</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topAbsentees.map((s, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="py-2 text-gray-800 font-medium">{s.staff_member_name || s.staff_name || s.name || `Staff ${i + 1}`}</td>
                        <td className="py-2 text-right text-green-600">{s.present || 0}</td>
                        <td className="py-2 text-right text-red-600 font-medium">{s.absent || 0}</td>
                        <td className="py-2 text-right text-amber-600">{s.on_leave || s.leave || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right Column */}
        <div className="lg:col-span-2 space-y-6">

          {/* Quick Actions */}
          <div>
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Quick Actions</h2>
            <QuickActionGrid actions={quickActions} />
          </div>

          {/* Payroll Overview */}
          {payrollNet > 0 && (
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Payroll Overview</h2>
              <div className="space-y-2.5">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Total Basic</span>
                  <span className="text-sm font-medium text-gray-800">Rs. {Number(payroll.total_basic || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Allowances</span>
                  <span className="text-sm font-medium text-green-600">+Rs. {Number(payroll.total_allowances || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Deductions</span>
                  <span className="text-sm font-medium text-red-600">-Rs. {Number(payroll.total_deductions || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-gray-200">
                  <span className="text-sm font-semibold text-gray-900">Net Pay</span>
                  <span className="text-base font-bold text-gray-900">Rs. {payrollNet.toLocaleString()}</span>
                </div>
                <div className="flex gap-2 mt-2">
                  {Object.entries(payrollStatus).map(([status, count]) => (
                    <span key={status} className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      status === 'PAID' ? 'bg-green-100 text-green-700'
                        : status === 'APPROVED' ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-600'
                    }`}>
                      {count} {status.toLowerCase()}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Notifications */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Notifications</h2>
            <NotificationsFeed limit={5} />
          </div>
        </div>
      </div>
    </div>
  )
}
