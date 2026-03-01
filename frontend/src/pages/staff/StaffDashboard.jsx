import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { hrApi, notificationsApi, inventoryApi } from '../../services/api'
import StatCard from '../../components/dashboard/StatCard'
import QuickActionGrid from '../../components/dashboard/QuickActionGrid'
import NotificationsFeed from '../../components/dashboard/NotificationsFeed'

// ─── Icons ──────────────────────────────────────────────────────────────────────
const icons = {
  calendar: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  leave: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  salary: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  bell: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  ),
  profile: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  leaveApply: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  payslip: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
    </svg>
  ),
  library: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  ),
  inventory: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
}

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export default function StaffDashboard() {
  const { user, isModuleEnabled } = useAuth()
  const now = new Date()
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const today = now.toISOString().split('T')[0]

  // Resolve staff member ID for current user
  const { data: staffRes } = useQuery({
    queryKey: ['myStaffRecord', user?.id],
    queryFn: () => hrApi.getStaff({ user: user?.id, page_size: 1 }),
    enabled: !!user?.id && isModuleEnabled('hr'),
  })
  const myStaff = (staffRes?.data?.results || staffRes?.data || [])[0]
  const myStaffId = myStaff?.id

  // My attendance this month
  const { data: attendanceRes, isLoading: loadingAttendance } = useQuery({
    queryKey: ['myStaffAttendance', myStaffId, monthStart, today],
    queryFn: () => hrApi.getStaffAttendance({ staff_member: myStaffId, date_from: monthStart, date_to: today, page_size: 50 }),
    enabled: !!myStaffId,
  })
  const attendanceRecords = attendanceRes?.data?.results || attendanceRes?.data || []

  // My leave balance
  const { data: leaveBalanceRes, isLoading: loadingLeave } = useQuery({
    queryKey: ['myLeaveBalance', myStaffId],
    queryFn: () => hrApi.getLeaveBalance(myStaffId),
    enabled: !!myStaffId,
  })
  const leaveBalances = leaveBalanceRes?.data || []

  // My payslips (latest 3)
  const { data: payslipsRes, isLoading: loadingPayslips } = useQuery({
    queryKey: ['myPayslips', myStaffId],
    queryFn: () => hrApi.getPayslips({ staff_member: myStaffId, page_size: 3, ordering: '-pay_period_end' }),
    enabled: !!myStaffId,
  })
  const payslips = payslipsRes?.data?.results || payslipsRes?.data || []

  // Unread notification count
  const { data: unreadRes } = useQuery({
    queryKey: ['unreadCount'],
    queryFn: () => notificationsApi.getUnreadCount(),
  })
  const unreadCount = unreadRes?.data?.unread_count || 0

  // Inventory assignments (if enabled)
  const { data: inventoryAssignRes } = useQuery({
    queryKey: ['myInventoryAssignments', user?.id],
    queryFn: () => inventoryApi.getAssignments({ user: user?.id, page_size: 5 }),
    enabled: !!user?.id && isModuleEnabled('inventory'),
  })
  const inventoryAssignments = inventoryAssignRes?.data?.results || inventoryAssignRes?.data || []

  // ─── Computed ─────────────────────────────────────────────────────────────────

  const attendanceSummary = useMemo(() => {
    let present = 0, absent = 0, leave = 0
    attendanceRecords.forEach(r => {
      const s = r.status?.toUpperCase()
      if (s === 'PRESENT') present++
      else if (s === 'ABSENT') absent++
      else if (s === 'ON_LEAVE' || s === 'LEAVE') leave++
    })
    return { present, absent, leave, total: present + absent + leave }
  }, [attendanceRecords])

  const totalLeaveRemaining = useMemo(() => {
    if (!Array.isArray(leaveBalances)) return null
    return leaveBalances.reduce((sum, lb) => sum + (lb.remaining || lb.balance || 0), 0)
  }, [leaveBalances])

  const latestPayslip = payslips[0]

  // Build attendance calendar data
  const calendarData = useMemo(() => {
    const map = {}
    attendanceRecords.forEach(r => {
      map[r.date] = r.status?.toUpperCase()
    })
    return map
  }, [attendanceRecords])

  // ─── Quick Actions ──────────────────────────────────────────────────────────

  const quickActions = [
    { label: 'My Profile', href: '/profile', icon: icons.profile },
  ]
  if (isModuleEnabled('hr')) {
    quickActions.push({ label: 'Apply Leave', href: '/hr/leave', icon: icons.leaveApply })
    quickActions.push({ label: 'My Payslips', href: '/hr/payroll', icon: icons.payslip })
  }
  quickActions.push({ label: 'Notifications', href: '/notifications', icon: icons.bell, badge: unreadCount })
  if (isModuleEnabled('library')) quickActions.push({ label: 'Library', href: '/library', icon: icons.library })
  if (isModuleEnabled('inventory')) quickActions.push({ label: 'Inventory', href: '/inventory', icon: icons.inventory })

  // ─── Mini Calendar ──────────────────────────────────────────────────────────

  const renderMiniCalendar = () => {
    const year = now.getFullYear()
    const month = now.getMonth()
    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const todayDate = now.getDate()
    const cells = []

    for (let i = 0; i < firstDay; i++) cells.push(<div key={`e-${i}`} />)

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const status = calendarData[dateStr]
      const isToday = d === todayDate
      let bg = 'bg-gray-50 text-gray-400'
      if (status === 'PRESENT') bg = 'bg-green-100 text-green-700'
      else if (status === 'ABSENT') bg = 'bg-red-100 text-red-700'
      else if (status === 'ON_LEAVE' || status === 'LEAVE') bg = 'bg-amber-100 text-amber-700'

      cells.push(
        <div
          key={d}
          className={`w-full aspect-square rounded flex items-center justify-center text-xs font-medium ${bg} ${isToday ? 'ring-2 ring-sky-400' : ''}`}
        >
          {d}
        </div>
      )
    }

    return (
      <div>
        <div className="grid grid-cols-7 gap-0.5 mb-1">
          {DAY_LABELS.map((l, i) => (
            <div key={i} className="text-center text-[10px] font-medium text-gray-400 py-1">{l}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">{cells}</div>
        <div className="flex gap-3 mt-3 text-[10px] text-gray-500">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-green-100" /> Present</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-red-100" /> Absent</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-amber-100" /> Leave</span>
        </div>
      </div>
    )
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  const hrEnabled = isModuleEnabled('hr')

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">
          Welcome back, {[user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username}
        </p>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Attendance This Month"
          value={hrEnabled ? `${attendanceSummary.present}/${attendanceSummary.total}` : '—'}
          subtitle={hrEnabled && attendanceSummary.total > 0 ? `${Math.round((attendanceSummary.present / attendanceSummary.total) * 100)}% present` : undefined}
          icon={icons.calendar}
          color="green"
          loading={hrEnabled && loadingAttendance}
        />
        <StatCard
          label="Leave Balance"
          value={totalLeaveRemaining != null ? totalLeaveRemaining : '—'}
          subtitle="days remaining"
          icon={icons.leave}
          color="amber"
          href={hrEnabled ? '/hr/leave' : undefined}
          loading={hrEnabled && loadingLeave}
        />
        <StatCard
          label="Last Salary"
          value={latestPayslip ? `Rs. ${Number(latestPayslip.net_salary || 0).toLocaleString()}` : '—'}
          subtitle={latestPayslip?.status || undefined}
          icon={icons.salary}
          color="blue"
          href={hrEnabled ? '/hr/payroll' : undefined}
          loading={hrEnabled && loadingPayslips}
        />
        <StatCard
          label="Notifications"
          value={unreadCount}
          subtitle="unread"
          icon={icons.bell}
          color={unreadCount > 0 ? 'red' : 'gray'}
          href="/notifications"
        />
      </div>

      {/* Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Left Column */}
        <div className="lg:col-span-3 space-y-6">

          {/* Attendance Calendar */}
          {hrEnabled && (
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">
                My Attendance — {now.toLocaleString('default', { month: 'long', year: 'numeric' })}
              </h2>
              {loadingAttendance ? (
                <div className="h-48 animate-pulse bg-gray-50 rounded-lg" />
              ) : (
                renderMiniCalendar()
              )}
            </div>
          )}

          {/* Announcements & Notifications */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Announcements & Notifications</h2>
            <NotificationsFeed limit={8} />
          </div>
        </div>

        {/* Right Column */}
        <div className="lg:col-span-2 space-y-6">

          {/* Quick Actions */}
          <div>
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Quick Actions</h2>
            <QuickActionGrid actions={quickActions} />
          </div>

          {/* Leave Balance Breakdown */}
          {hrEnabled && Array.isArray(leaveBalances) && leaveBalances.length > 0 && (
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Leave Balance</h2>
              <div className="space-y-2">
                {leaveBalances.map((lb, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-gray-600">{lb.leave_type || lb.policy_name || lb.type || `Type ${i + 1}`}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">{lb.remaining ?? lb.balance ?? 0}</span>
                      <span className="text-xs text-gray-400">/ {lb.total ?? lb.allocated ?? '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Payslips */}
          {hrEnabled && payslips.length > 0 && (
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Recent Payslips</h2>
              <div className="space-y-2">
                {payslips.map(p => (
                  <div key={p.id} className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {p.pay_period_start && p.pay_period_end
                          ? `${new Date(p.pay_period_start).toLocaleDateString('default', { month: 'short' })} ${new Date(p.pay_period_start).getFullYear()}`
                          : 'Payslip'}
                      </p>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                        p.status === 'PAID' ? 'bg-green-100 text-green-700'
                          : p.status === 'APPROVED' ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-600'
                      }`}>
                        {p.status}
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">
                      Rs. {Number(p.net_salary || 0).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Assigned Inventory */}
          {isModuleEnabled('inventory') && inventoryAssignments.length > 0 && (
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Assigned Items</h2>
              <div className="space-y-1.5">
                {inventoryAssignments.map(a => (
                  <div key={a.id} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-gray-700">{a.item_name || a.item?.name || 'Item'}</span>
                    <span className="text-xs text-gray-400">{a.assigned_date ? new Date(a.assigned_date).toLocaleDateString() : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
