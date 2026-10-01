import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import {
  attendanceApi, financeApi, tasksApi, hrApi,
  admissionsApi, libraryApi, inventoryApi, bootstrapApi,
} from '../../services/api'

import SessionHealthWidget from '../../components/SessionHealthWidget'
import StatCard from '../../components/dashboard/StatCard'
import QuickActionGrid from '../../components/dashboard/QuickActionGrid'
import NotificationsFeed from '../../components/dashboard/NotificationsFeed'
import AttentionStrip, { buildAttentionItems } from '../../components/dashboard/AttentionStrip'
import LeadershipInsightsPanels from '../../components/dashboard/LeadershipInsightsPanels'
import { icons, AIInsightsCard } from '../DashboardPage'

// SCHOOL_ADMIN dashboard. PRINCIPAL and the other roles still use DashboardPage.
// Query keys below match the ones AuthContext's login-time bootstrap prefetch seeds
// (dailyReport, hrDashboardStats, financeSummaryDashboard) — changing them would
// silently turn those cache hits into cold fetches.
export default function AdminDashboard() {
  const { activeSchool, isModuleEnabled } = useAuth()
  const { activeAcademicYear, currentTerm, hasAcademicYear, loading: academicYearLoading } = useAcademicYear()
  const [insightsOpen, setInsightsOpen] = useState(false)

  const today = new Date().toISOString().split('T')[0]
  const currentMonth = new Date().getMonth() + 1
  const currentYear = new Date().getFullYear()
  const schoolReady = !!activeSchool?.id

  const attendanceOn = isModuleEnabled('attendance')
  const financeOn = isModuleEnabled('finance')
  const hrOn = isModuleEnabled('hr')

  const { data: dailyReport, isLoading: loadingAttendance } = useQuery({
    queryKey: ['dailyReport', today, activeSchool?.id, activeAcademicYear?.id],
    queryFn: () => attendanceApi.getDailyReport(today, activeSchool?.id, activeAcademicYear?.id),
    enabled: schoolReady && attendanceOn,
  })

  const { data: financeSummary, isLoading: loadingFinance } = useQuery({
    queryKey: ['financeSummaryDashboard', currentMonth, currentYear, activeAcademicYear?.id],
    queryFn: () => financeApi.getMonthlySummary({
      month: currentMonth, year: currentYear,
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
    }),
    enabled: schoolReady && financeOn,
  })

  const { data: hrStats, isLoading: loadingHR } = useQuery({
    queryKey: ['hrDashboardStats'],
    queryFn: () => hrApi.getDashboardStats(),
    enabled: schoolReady && hrOn,
  })

  const { data: admissionsData } = useQuery({
    queryKey: ['admissionsNewCount'],
    queryFn: () => admissionsApi.getEnquiries({ status: 'NEW', page_size: 1 }),
    enabled: schoolReady && isModuleEnabled('admissions'),
  })

  const { data: libraryData } = useQuery({
    queryKey: ['libraryStats'],
    queryFn: () => libraryApi.getStats(),
    enabled: schoolReady && isModuleEnabled('library'),
  })

  const { data: inventoryData } = useQuery({
    queryKey: ['inventoryDashboard'],
    queryFn: () => inventoryApi.getDashboard(),
    enabled: schoolReady && isModuleEnabled('inventory'),
  })

  // Same key as AIInsightsCard so the two share one request.
  const { data: aiData } = useQuery({
    queryKey: ['aiInsights'],
    queryFn: () => tasksApi.getAIInsights(),
    refetchInterval: 5 * 60 * 1000,
  })

  const leadershipRosterGate = isModuleEnabled('students') || isModuleEnabled('admissions')
  const leadershipCurriculumGate = isModuleEnabled('lms') || isModuleEnabled('examinations')
  // Heavy aggregate query — only worth running once the admin opens the section.
  const { data: leadershipApiRes, isLoading: loadingLeadership } = useQuery({
    queryKey: ['leadershipAcademicInsights', activeSchool?.id, activeAcademicYear?.id, today],
    queryFn: () => bootstrapApi.getLeadershipAcademicInsights({
      reference_date: today,
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
    }),
    enabled: schoolReady && insightsOpen && (leadershipRosterGate || leadershipCurriculumGate),
  })

  // ─── Derived values ─────────────────────────────────────────────────────────

  const report = dailyReport?.data
  const fin = financeSummary?.data
  const hr = hrStats?.data
  const isOffDay = !!report?.is_off_day

  const attendanceRate = !isOffDay && report?.total_students > 0
    ? Math.round((report.present_count / report.total_students) * 100) : null
  const collectionRate = fin?.total_due > 0
    ? Math.round((Number(fin.total_collected) / Number(fin.total_due)) * 100) : null
  const staffPresentPct = !isOffDay && hr?.active_staff > 0
    ? Math.round(((hr.attendance_present_today || 0) / hr.active_staff) * 100) : null
  const notMarkedCount = report
    ? Math.max((report.total_students || 0) - (report.present_count || 0) - (report.absent_count || 0), 0)
    : 0

  const attentionLoading = (attendanceOn && loadingAttendance) || (financeOn && loadingFinance) || (hrOn && loadingHR)
  const attentionItems = buildAttentionItems({
    isModuleEnabled,
    isOffDay,
    notMarkedStudents: report ? notMarkedCount : undefined,
    unpaidFees: fin?.unpaid_count,
    partialFees: fin?.partial_count,
    pendingLeave: hr?.pending_leave_applications,
    pendingPayroll: hr?.pending_payroll_approvals,
    staffUnmarked: hr ? Math.max((hr.active_staff || 0) - (hr.attendance_marked_today || 0), 0) : undefined,
    newEnquiries: admissionsData?.data?.count,
    overdueBooks: libraryData?.data?.total_overdue,
    lowStock: inventoryData?.data?.low_stock_count,
    aiAlerts: (aiData?.data?.insights || []).filter((i) => i.type === 'alert').length,
  })

  const quickActions = []
  if (financeOn) quickActions.push({ label: 'Record Payment', href: '/finance/fee-payments', icon: icons.payment })
  quickActions.push({ label: 'Add Student', href: '/students', icon: icons.students })
  if (isModuleEnabled('admissions')) quickActions.push({ label: 'New Enquiry', href: '/admissions/new', icon: icons.admissions })
  if (hrOn) quickActions.push({ label: 'Staff Directory', href: '/hr/staff', icon: icons.staff })
  if (isModuleEnabled('notifications')) quickActions.push({ label: 'Send Notification', href: '/notifications', icon: icons.notify })
  quickActions.push({ label: 'Reports', href: '/reports', icon: icons.reports })
  quickActions.push({ label: 'School Setup', href: '/school-setup', icon: icons.setup })

  const showToday = (attendanceOn && report) || (financeOn && fin) || (hrOn && hr)

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {activeSchool?.name || 'Welcome back'}
            {activeAcademicYear && <span className="text-gray-400"> — {activeAcademicYear.name}</span>}
            {currentTerm && <span className="text-gray-400"> | {currentTerm.name}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-500">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          {isOffDay && (
            <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-700 font-semibold">
              OFF day{report?.off_day_types?.length ? `: ${report.off_day_types.join(', ')}` : ''}
            </span>
          )}
        </div>
      </div>

      {!academicYearLoading && !hasAcademicYear && (
        <div className="mb-6 flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
          <svg className="w-5 h-5 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800">No Academic Session Set</p>
            <p className="text-xs text-amber-600">Create an academic year and set it as current to enable session-aware features.</p>
          </div>
          <Link to="/academics/sessions" className="btn-primary text-xs px-3 py-1.5">Setup Now</Link>
        </div>
      )}

      <AttentionStrip items={attentionItems} loading={attentionLoading} />

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Total Students"
          value={report?.total_students ?? '—'}
          subtitle={report ? (isOffDay ? 'OFF day' : `${report.present_count} present today`) : undefined}
          icon={icons.students}
          color="blue"
          href="/students"
          loading={attendanceOn && loadingAttendance}
        />
        <StatCard
          label="Attendance Rate"
          value={isOffDay ? 'N/A' : attendanceRate != null ? `${attendanceRate}%` : '—'}
          subtitle={isOffDay ? 'OFF day' : report ? `${report.absent_count} absent` : undefined}
          icon={icons.attendance}
          color={isOffDay || attendanceRate == null ? 'gray' : attendanceRate >= 90 ? 'green' : attendanceRate >= 75 ? 'amber' : 'red'}
          href="/attendance/register"
          loading={attendanceOn && loadingAttendance}
        />
        <StatCard
          label="Fee Collection"
          value={collectionRate != null ? `${collectionRate}%` : '—'}
          subtitle={fin ? `Rs. ${Number(fin.total_collected || 0).toLocaleString()} collected` : undefined}
          icon={icons.finance}
          color={collectionRate == null ? 'gray' : collectionRate >= 80 ? 'green' : collectionRate >= 50 ? 'amber' : 'orange'}
          href="/finance"
          loading={financeOn && loadingFinance}
        />
        <StatCard
          label="Staff Present"
          value={isOffDay ? 'N/A' : staffPresentPct != null ? `${staffPresentPct}%` : hr ? `${hr.total_staff}` : '—'}
          subtitle={hr ? (isOffDay ? 'OFF day' : (staffPresentPct != null ? `${hr.staff_on_leave_today || 0} on leave` : 'total staff')) : undefined}
          icon={icons.staff}
          color={isOffDay ? 'gray' : 'purple'}
          href="/hr/attendance"
          loading={hrOn && loadingHR}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left column */}
        <div className="lg:col-span-3 space-y-6">
          {showToday && (
            <div className="card space-y-5">
              <h2 className="text-sm font-semibold text-gray-900">Today at a glance</h2>

              {attendanceOn && report && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Student attendance</p>
                    <Link to="/attendance/register" className="text-xs text-sky-600 hover:text-sky-700 font-medium">View details</Link>
                  </div>
                  {isOffDay ? (
                    <p className="text-sm text-gray-600">Attendance is not applicable today.</p>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 mb-2">
                        <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden flex">
                          {report.total_students > 0 && (
                            <>
                              <div className="bg-green-500 h-full transition-all duration-500" style={{ width: `${(report.present_count / report.total_students) * 100}%` }} />
                              <div className="bg-red-400 h-full transition-all duration-500" style={{ width: `${(report.absent_count / report.total_students) * 100}%` }} />
                            </>
                          )}
                        </div>
                        <span className="text-xs text-gray-500 shrink-0 tabular-nums">{report.present_count}/{report.total_students}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500" />Present: {report.present_count}</span>
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-400" />Absent: {report.absent_count}</span>
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-gray-400" />Not marked: {notMarkedCount}</span>
                      </div>
                    </>
                  )}
                </div>
              )}

              {financeOn && fin && (
                <div className="pt-4 border-t border-gray-100">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Fees this month</p>
                    <Link to="/finance/fees" className="text-xs text-sky-600 hover:text-sky-700 font-medium">View details</Link>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="text-center p-3 bg-green-50 rounded-lg">
                      <p className="text-xs text-green-600 mb-0.5">Collected</p>
                      <p className="text-sm sm:text-base font-bold text-green-700">Rs. {Number(fin.total_collected || 0).toLocaleString()}</p>
                    </div>
                    <div className="text-center p-3 bg-orange-50 rounded-lg">
                      <p className="text-xs text-orange-600 mb-0.5">Pending</p>
                      <p className="text-sm sm:text-base font-bold text-orange-700">Rs. {Number(fin.total_pending || 0).toLocaleString()}</p>
                    </div>
                    <div className="text-center p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs text-gray-600 mb-0.5">Paid / Partial / Unpaid</p>
                      <p className="text-sm sm:text-base font-bold text-gray-700 tabular-nums">
                        {fin.paid_count ?? 0} / {fin.partial_count ?? 0} / {fin.unpaid_count ?? 0}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {hrOn && hr && (
                <div className="pt-4 border-t border-gray-100">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Staff</p>
                    <Link to="/hr" className="text-xs text-sky-600 hover:text-sky-700 font-medium">View details</Link>
                  </div>
                  <p className="text-sm text-gray-700">
                    {isOffDay
                      ? 'Staff attendance is not applicable today.'
                      : `${hr.attendance_present_today || 0} of ${hr.active_staff || 0} present · ${hr.staff_on_leave_today || 0} on leave`}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* id is the in-page target of the "AI alerts" attention chip */}
          <div id="ai-insights" className="scroll-mt-4">
            <AIInsightsCard />
          </div>

          <SessionHealthWidget />
        </div>

        {/* Right column */}
        <div className="lg:col-span-2 space-y-6">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Quick Actions</h2>
            <QuickActionGrid actions={quickActions} />
          </div>

          <div className="card">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Recent Notifications</h2>
            <NotificationsFeed limit={5} />
          </div>
        </div>
      </div>

      {(leadershipRosterGate || leadershipCurriculumGate) && (
        <div className="mt-8">
          <button
            type="button"
            onClick={() => setInsightsOpen((o) => !o)}
            aria-expanded={insightsOpen}
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-left"
          >
            <span>
              <span className="block text-sm font-semibold text-gray-900">Academic insights</span>
              <span className="block text-xs text-gray-500">Admissions &amp; departures, curriculum and lesson-plan coverage</span>
            </span>
            <svg className={`w-4 h-4 text-gray-500 transition-transform ${insightsOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {insightsOpen && (
            <div className="mt-4">
              <LeadershipInsightsPanels
                data={leadershipApiRes?.data}
                loading={loadingLeadership}
                showRoster={leadershipRosterGate}
                showCurriculum={leadershipCurriculumGate}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
