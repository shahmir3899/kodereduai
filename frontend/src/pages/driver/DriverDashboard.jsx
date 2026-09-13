import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { hrApi, notificationsApi, transportApi } from '../../services/api'
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
  vehicle: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 17a2 2 0 11-4 0 2 2 0 014 0zM20 17a2 2 0 11-4 0 2 2 0 014 0zM4 17h1m14 0h1M6 17V9a1 1 0 011-1h10a1 1 0 011 1v8M6 13h12" />
    </svg>
  ),
  route: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
    </svg>
  ),
}

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export default function DriverDashboard() {
  const { user, isModuleEnabled } = useAuth()
  const now = new Date()
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const today = now.toISOString().split('T')[0]

  // ── Self-service HR (same pattern as StaffDashboard.jsx — Driver is a
  // staff-level role with the same HR self-service entitlements) ──
  const { data: staffRes } = useQuery({
    queryKey: ['myStaffRecord', user?.id],
    queryFn: () => hrApi.getStaff({ user: user?.id, page_size: 1 }),
    enabled: !!user?.id && isModuleEnabled('hr'),
  })
  const myStaff = (staffRes?.data?.results || staffRes?.data || [])[0]
  const myStaffId = myStaff?.id

  const { data: attendanceRes, isLoading: loadingAttendance } = useQuery({
    queryKey: ['myStaffAttendance', myStaffId, monthStart, today],
    queryFn: () => hrApi.getStaffAttendance({ staff_member: myStaffId, date_from: monthStart, date_to: today, page_size: 50 }),
    enabled: !!myStaffId,
  })
  const attendanceRecords = attendanceRes?.data?.results || attendanceRes?.data || []

  const { data: attendanceSummaryRes } = useQuery({
    queryKey: ['myStaffAttendanceSummary', myStaffId, monthStart, today],
    queryFn: () => hrApi.getAttendanceSummary({ staff_member: myStaffId, date_from: monthStart, date_to: today }),
    enabled: !!myStaffId,
  })
  const attendanceSummaryRows = attendanceSummaryRes?.data || []

  const { data: leaveBalanceRes, isLoading: loadingLeave } = useQuery({
    queryKey: ['myLeaveBalance', myStaffId],
    queryFn: () => hrApi.getLeaveBalance(myStaffId),
    enabled: !!myStaffId,
  })
  const leaveBalances = leaveBalanceRes?.data || []

  const { data: payslipsRes, isLoading: loadingPayslips } = useQuery({
    queryKey: ['myPayslips', myStaffId],
    queryFn: () => hrApi.getPayslips({ staff_member: myStaffId, page_size: 3, ordering: '-pay_period_end' }),
    enabled: !!myStaffId,
  })
  const payslips = payslipsRes?.data?.results || payslipsRes?.data || []

  const { data: unreadRes } = useQuery({
    queryKey: ['unreadCount'],
    queryFn: () => notificationsApi.getUnreadCount(),
  })
  const unreadCount = unreadRes?.data?.unread_count || 0

  // ── Transport (driver-specific — mirrors the mobile driver dashboard's
  // vehicle/route/stops flow, minus live GPS journey tracking which is
  // mobile-only and not meaningful on a web dashboard) ──
  const { data: vehicleRes, isLoading: loadingVehicle } = useQuery({
    queryKey: ['myVehicle'],
    queryFn: () => transportApi.getMyVehicle(),
    enabled: isModuleEnabled('transport'),
    retry: false, // 404 (no vehicle assigned) is an expected, not a transient, response
  })
  const vehicle = vehicleRes?.data || null
  const assignedRouteId = vehicle?.assigned_route

  const { data: routeRes, isLoading: loadingRoute } = useQuery({
    queryKey: ['myVehicleRoute', assignedRouteId],
    queryFn: () => transportApi.getRoute(assignedRouteId),
    enabled: !!assignedRouteId,
  })
  const route = routeRes?.data || null

  const { data: stopsRes } = useQuery({
    queryKey: ['myVehicleRouteStops', assignedRouteId],
    queryFn: () => transportApi.getStops({ route: assignedRouteId, page_size: 999 }),
    enabled: !!assignedRouteId,
  })
  const stops = useMemo(() => {
    const rows = stopsRes?.data?.results || stopsRes?.data || []
    return [...rows].sort((a, b) => (a.stop_order || 0) - (b.stop_order || 0))
  }, [stopsRes])

  // ── Computed (attendance) ──
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

  const mySummaryRow = useMemo(() => {
    if (!Array.isArray(attendanceSummaryRows) || !myStaffId) return null
    return attendanceSummaryRows.find(r => Number(r.staff_member) === Number(myStaffId)) || null
  }, [attendanceSummaryRows, myStaffId])

  const workingDays = mySummaryRow?.working_days
  const offDays = mySummaryRow?.off_days
  const presentDays = mySummaryRow?.present ?? attendanceSummary.present
  const presentRate = mySummaryRow?.attendance_rate != null
    ? Math.round(Number(mySummaryRow.attendance_rate))
    : (attendanceSummary.total > 0 ? Math.round((attendanceSummary.present / attendanceSummary.total) * 100) : null)

  const totalLeaveRemaining = useMemo(() => {
    if (!Array.isArray(leaveBalances)) return null
    return leaveBalances.reduce((sum, lb) => sum + (lb.remaining || lb.balance || 0), 0)
  }, [leaveBalances])

  const latestPayslip = payslips[0]

  const calendarData = useMemo(() => {
    const map = {}
    attendanceRecords.forEach(r => { map[r.date] = r.status?.toUpperCase() })
    return map
  }, [attendanceRecords])

  // ─── Quick Actions ──────────────────────────────────────────────────────────

  const hrEnabled = isModuleEnabled('hr')
  const quickActions = [
    { label: 'My Profile', href: '/profile', icon: icons.profile },
  ]
  if (hrEnabled) {
    quickActions.push({ label: 'Apply Leave', href: '/hr/leave', icon: icons.leaveApply })
    quickActions.push({ label: 'My Payslips', href: '/hr/payroll', icon: icons.payslip })
  }
  quickActions.push({ label: 'Notifications', href: '/notifications', icon: icons.bell, badge: unreadCount })

  // ─── Mini Calendar (same as StaffDashboard.jsx) ──────────────────────────────

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

  const transportEnabled = isModuleEnabled('transport')

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Driver Dashboard</h1>
        <p className="text-sm text-gray-500">
          Welcome back, {[user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username}
        </p>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Attendance This Month"
          value={hrEnabled ? (workingDays === 0 ? 'N/A' : `${presentDays}/${workingDays ?? attendanceSummary.total}`) : '—'}
          subtitle={hrEnabled ? (workingDays === 0
            ? `Only OFF days${offDays != null ? ` (${offDays})` : ''}`
            : `${presentRate ?? 0}% present${offDays != null ? ` • ${offDays} OFF` : ''}`) : undefined}
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
          label="My Vehicle"
          value={transportEnabled ? (vehicle?.vehicle_number || (loadingVehicle ? '—' : 'Unassigned')) : '—'}
          subtitle={vehicle?.assigned_route_name || route?.name || undefined}
          icon={icons.vehicle}
          color={vehicle ? 'sky' : 'gray'}
          loading={transportEnabled && loadingVehicle}
        />
      </div>

      {/* Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Left Column */}
        <div className="lg:col-span-3 space-y-6">

          {/* My Route */}
          {transportEnabled && route && (
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">My Route — {route.name}</h2>
              <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                <div>
                  <p className="text-gray-500 text-xs">From</p>
                  <p className="font-medium text-gray-800">{route.start_location || '—'}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">To</p>
                  <p className="font-medium text-gray-800">{route.end_location || '—'}</p>
                </div>
                {route.distance_km && (
                  <div>
                    <p className="text-gray-500 text-xs">Distance</p>
                    <p className="font-medium text-gray-800">{route.distance_km} km</p>
                  </div>
                )}
                {route.estimated_duration_minutes && (
                  <div>
                    <p className="text-gray-500 text-xs">Est. Duration</p>
                    <p className="font-medium text-gray-800">{route.estimated_duration_minutes} min</p>
                  </div>
                )}
              </div>
              {stops.length > 0 && (
                <>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Stops ({stops.length})</h3>
                  <div className="space-y-2">
                    {stops.map((stop) => (
                      <div key={stop.id} className="flex items-start gap-3 py-1.5 border-b border-gray-50 last:border-0">
                        <span className="w-6 h-6 rounded-full bg-sky-100 text-sky-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                          {stop.stop_order}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{stop.name}</p>
                          {stop.address && <p className="text-xs text-gray-500 truncate">{stop.address}</p>}
                          <p className="text-xs text-gray-400">Pickup: {stop.pickup_time || '—'} • Drop: {stop.drop_time || '—'}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {transportEnabled && !loadingVehicle && !vehicle && (
            <div className="card text-center py-6 text-gray-500 text-sm">
              No vehicle assigned to your account. Contact your school administrator.
            </div>
          )}

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

          {/* My Vehicle */}
          {transportEnabled && vehicle && (
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">My Vehicle</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Number</span>
                  <span className="font-medium text-gray-900">{vehicle.vehicle_number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Type</span>
                  <span className="font-medium text-gray-900">{vehicle.vehicle_type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Capacity</span>
                  <span className="font-medium text-gray-900">{vehicle.capacity} seats</span>
                </div>
                {loadingRoute && <div className="h-4 w-24 animate-pulse bg-gray-100 rounded" />}
              </div>
            </div>
          )}

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
        </div>
      </div>
    </div>
  )
}
