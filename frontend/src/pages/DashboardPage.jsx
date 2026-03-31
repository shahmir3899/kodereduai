import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { useAcademicYear } from '../contexts/AcademicYearContext'
import {
  attendanceApi, financeApi, tasksApi, hrApi,
  admissionsApi, examinationsApi, transportApi,
  libraryApi, hostelApi, inventoryApi, notificationsApi,
} from '../services/api'
import { Link } from 'react-router-dom'

import SessionHealthWidget from '../components/SessionHealthWidget'
import AttendanceRiskWidget from '../components/AttendanceRiskWidget'
import StatCard from '../components/dashboard/StatCard'
import ModuleHealthCard from '../components/dashboard/ModuleHealthCard'
import QuickActionGrid from '../components/dashboard/QuickActionGrid'
import NotificationsFeed from '../components/dashboard/NotificationsFeed'

// ─── SVG Icons ──────────────────────────────────────────────────────────────────
const icons = {
  students: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  ),
  attendance: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  finance: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  staff: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 13.255A23.193 23.193 0 0112 15c-3.183 0-6.22-.64-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
  admissions: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
    </svg>
  ),
  exams: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  transport: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h8m-8 4h8m-4 4v3m-6 0h12a1 1 0 001-1V5a1 1 0 00-1-1H6a1 1 0 00-1 1v12a1 1 0 001 1zm-2 0a2 2 0 104 0m8 0a2 2 0 104 0" />
    </svg>
  ),
  library: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  ),
  hostel: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  ),
  inventory: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
  upload: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
  ),
  payment: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  setup: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  reports: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  notify: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  ),
  lessonPlan: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  ),
  academics: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
    </svg>
  ),
}


export default function DashboardPage({ variant }) {
  const { user, activeSchool, isModuleEnabled } = useAuth()
  const { activeAcademicYear, currentTerm, hasAcademicYear, loading: academicYearLoading } = useAcademicYear()
  const today = new Date().toISOString().split('T')[0]
  const currentMonth = new Date().getMonth() + 1
  const currentYear = new Date().getFullYear()

  const isPrincipal = variant === 'principal'

  // ─── Data Queries ───────────────────────────────────────────────────────────

  // Attendance
  const { data: dailyReport, isLoading: loadingAttendance } = useQuery({
    queryKey: ['dailyReport', today, activeSchool?.id, activeAcademicYear?.id],
    queryFn: () => attendanceApi.getDailyReport(today, activeSchool?.id, activeAcademicYear?.id),
    enabled: !!activeSchool?.id && isModuleEnabled('attendance'),
  })

  const { data: pendingReviews } = useQuery({
    queryKey: ['pendingReviews', activeAcademicYear?.id],
    queryFn: () => attendanceApi.getPendingReviews({
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
    }),
    enabled: isModuleEnabled('attendance'),
  })

  // Finance
  const { data: financeSummary, isLoading: loadingFinance } = useQuery({
    queryKey: ['financeSummaryDashboard', currentMonth, currentYear, activeAcademicYear?.id],
    queryFn: () => financeApi.getMonthlySummary({
      month: currentMonth, year: currentYear,
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
    }),
    enabled: !!activeSchool?.id && isModuleEnabled('finance'),
  })

  // HR
  const { data: hrStats, isLoading: loadingHR } = useQuery({
    queryKey: ['hrDashboardStats'],
    queryFn: () => hrApi.getDashboardStats(),
    enabled: !!activeSchool?.id && isModuleEnabled('hr'),
  })

  // Admissions
  const { data: admissionsData } = useQuery({
    queryKey: ['admissionsNewCount'],
    queryFn: () => admissionsApi.getEnquiries({ status: 'NEW', page_size: 1 }),
    enabled: !!activeSchool?.id && isModuleEnabled('admissions'),
  })

  // Exams
  const { data: examsData } = useQuery({
    queryKey: ['upcomingExams'],
    queryFn: () => examinationsApi.getExams({ status: 'SCHEDULED', page_size: 1 }),
    enabled: !!activeSchool?.id && isModuleEnabled('examinations'),
  })

  // Transport
  const { data: transportData, isLoading: loadingTransport } = useQuery({
    queryKey: ['transportDashboard'],
    queryFn: () => transportApi.getDashboardStats(),
    enabled: !!activeSchool?.id && isModuleEnabled('transport'),
  })

  // Library
  const { data: libraryData, isLoading: loadingLibrary } = useQuery({
    queryKey: ['libraryStats'],
    queryFn: () => libraryApi.getStats(),
    enabled: !!activeSchool?.id && isModuleEnabled('library'),
  })

  // Hostel
  const { data: hostelData, isLoading: loadingHostel } = useQuery({
    queryKey: ['hostelDashboard'],
    queryFn: () => hostelApi.getDashboard(),
    enabled: !!activeSchool?.id && isModuleEnabled('hostel'),
  })

  // Inventory
  const { data: inventoryData, isLoading: loadingInventory } = useQuery({
    queryKey: ['inventoryDashboard'],
    queryFn: () => inventoryApi.getDashboard(),
    enabled: !!activeSchool?.id && isModuleEnabled('inventory'),
  })

  // ─── Computed Values ────────────────────────────────────────────────────────

  const report = dailyReport?.data
  const fin = financeSummary?.data
  const hr = hrStats?.data
  const pendingCount = pendingReviews?.data?.length || 0
  const admissionsCount = admissionsData?.data?.count || 0
  const examsCount = examsData?.data?.count || 0
  const attendanceIsOffDay = !!report?.is_off_day

  const attendanceRate = !attendanceIsOffDay && report?.total_students > 0
    ? Math.round((report.present_count / report.total_students) * 100) : null
  const collectionRate = fin?.total_due > 0
    ? Math.round((Number(fin.total_collected) / Number(fin.total_due)) * 100) : null
  const staffPresentPct = !attendanceIsOffDay && hr?.active_staff > 0
    ? Math.round(((hr.attendance_present_today || 0) / hr.active_staff) * 100) : null

  // ─── Quick Actions ──────────────────────────────────────────────────────────

  const quickActions = []
  if (isPrincipal) {
    if (isModuleEnabled('academics')) quickActions.push({ label: 'Lesson Plans', href: '/academics/lesson-plans', icon: icons.lessonPlan })
    if (isModuleEnabled('examinations')) quickActions.push({ label: 'Examinations', href: '/academics/exams', icon: icons.exams })
    quickActions.push({ label: 'Classes', href: '/classes', icon: icons.academics })
  } else {
    if (isModuleEnabled('attendance')) quickActions.push({ label: 'Upload Attendance', href: '/attendance', icon: icons.upload, badge: pendingCount })
    if (isModuleEnabled('finance')) quickActions.push({ label: 'Record Payment', href: '/finance/fee-payments', icon: icons.payment })
    quickActions.push({ label: 'Add Student', href: '/students', icon: icons.students })
  }
  if (isModuleEnabled('hr')) quickActions.push({ label: 'Staff Directory', href: '/hr/staff', icon: icons.staff })
  if (isModuleEnabled('notifications')) quickActions.push({ label: 'Send Notification', href: '/notifications', icon: icons.notify })
  quickActions.push({ label: 'School Setup', href: '/school-setup', icon: icons.setup })
  quickActions.push({ label: 'Reports', href: '/reports', icon: icons.reports })

  // ─── Module Health Cards ────────────────────────────────────────────────────

  const moduleCards = []

  if (isModuleEnabled('attendance')) {
    moduleCards.push({
      key: 'attendance', icon: icons.attendance, label: 'Attendance',
      metric: attendanceIsOffDay ? 'N/A' : attendanceRate != null ? `${attendanceRate}%` : '—',
      metricLabel: attendanceIsOffDay ? 'off day' : 'today',
      status: attendanceRate == null ? 'gray' : attendanceRate >= 90 ? 'green' : attendanceRate >= 75 ? 'yellow' : 'red',
      href: '/attendance', loading: loadingAttendance,
    })
  }

  if (isModuleEnabled('finance')) {
    moduleCards.push({
      key: 'finance', icon: icons.finance, label: 'Finance',
      metric: collectionRate != null ? `${collectionRate}%` : '—',
      metricLabel: 'collected',
      status: collectionRate == null ? 'gray' : collectionRate >= 80 ? 'green' : collectionRate >= 50 ? 'yellow' : 'red',
      href: '/finance', loading: loadingFinance,
    })
  }

  if (isModuleEnabled('hr')) {
    moduleCards.push({
      key: 'hr', icon: icons.staff, label: 'HR & Staff',
      metric: attendanceIsOffDay ? 'N/A' : staffPresentPct != null ? `${staffPresentPct}%` : '—',
      metricLabel: attendanceIsOffDay ? 'off day' : 'present',
      status: staffPresentPct == null ? 'gray' : staffPresentPct >= 90 ? 'green' : staffPresentPct >= 75 ? 'yellow' : 'red',
      href: '/hr', loading: loadingHR,
    })
  }

  if (isModuleEnabled('examinations')) {
    moduleCards.push({
      key: 'exams', icon: icons.exams, label: 'Examinations',
      metric: examsCount, metricLabel: 'upcoming',
      status: 'gray', href: '/academics/exams',
    })
  }

  if (isModuleEnabled('admissions')) {
    moduleCards.push({
      key: 'admissions', icon: icons.admissions, label: 'Admissions',
      metric: admissionsCount, metricLabel: 'new enquiries',
      status: admissionsCount > 0 ? 'yellow' : 'green', href: '/admissions',
    })
  }

  if (isModuleEnabled('transport')) {
    const td = transportData?.data
    moduleCards.push({
      key: 'transport', icon: icons.transport, label: 'Transport',
      metric: td?.total_routes || '—', metricLabel: 'routes',
      status: 'gray', href: '/transport', loading: loadingTransport,
    })
  }

  if (isModuleEnabled('library')) {
    const ld = libraryData?.data
    const overdue = ld?.total_overdue || 0
    moduleCards.push({
      key: 'library', icon: icons.library, label: 'Library',
      metric: overdue > 0 ? overdue : ld?.total_books || '—',
      metricLabel: overdue > 0 ? 'overdue' : 'books',
      status: overdue > 0 ? 'yellow' : 'green', href: '/library', loading: loadingLibrary,
    })
  }

  if (isModuleEnabled('hostel')) {
    const hd = hostelData?.data
    const occupancy = hd?.total_capacity > 0
      ? Math.round((hd.current_occupancy / hd.total_capacity) * 100) : null
    moduleCards.push({
      key: 'hostel', icon: icons.hostel, label: 'Hostel',
      metric: occupancy != null ? `${occupancy}%` : '—',
      metricLabel: 'occupancy',
      status: 'gray', href: '/hostel', loading: loadingHostel,
    })
  }

  if (isModuleEnabled('inventory')) {
    const id = inventoryData?.data
    const lowStock = id?.low_stock_count || 0
    moduleCards.push({
      key: 'inventory', icon: icons.inventory, label: 'Inventory',
      metric: lowStock > 0 ? lowStock : id?.total_items || '—',
      metricLabel: lowStock > 0 ? 'low stock' : 'items',
      status: lowStock > 0 ? 'red' : 'green', href: '/inventory', loading: loadingInventory,
    })
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {activeSchool?.name || 'Welcome back'}
          {activeAcademicYear && <span className="text-gray-400"> — {activeAcademicYear.name}</span>}
          {currentTerm && <span className="text-gray-400"> | {currentTerm.name}</span>}
        </p>
      </div>

      {/* Academic Session Warning */}
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

      {/* KPI Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Total Students"
          value={report?.total_students ?? '—'}
          subtitle={report ? (attendanceIsOffDay ? 'OFF day' : `${report.present_count} present today`) : undefined}
          icon={icons.students}
          color="blue"
          href="/students"
          loading={isModuleEnabled('attendance') && loadingAttendance}
        />
        <StatCard
          label="Attendance Rate"
          value={attendanceIsOffDay ? 'N/A' : attendanceRate != null ? `${attendanceRate}%` : '—'}
          subtitle={attendanceIsOffDay ? `OFF day${report?.off_day_types?.length ? ` (${report.off_day_types.join(', ')})` : ''}` : report ? `${report.absent_count} absent` : undefined}
          icon={icons.attendance}
          color={attendanceIsOffDay ? 'gray' : attendanceRate >= 90 ? 'green' : attendanceRate >= 75 ? 'amber' : 'red'}
          href="/attendance"
          loading={isModuleEnabled('attendance') && loadingAttendance}
        />
        <StatCard
          label="Fee Collection"
          value={collectionRate != null ? `${collectionRate}%` : '—'}
          subtitle={fin ? `Rs. ${Number(fin.total_collected || 0).toLocaleString()} collected` : undefined}
          icon={icons.finance}
          color={collectionRate >= 80 ? 'green' : collectionRate >= 50 ? 'amber' : 'orange'}
          href="/finance"
          loading={isModuleEnabled('finance') && loadingFinance}
        />
        <StatCard
          label="Staff Present"
          value={attendanceIsOffDay ? 'N/A' : staffPresentPct != null ? `${staffPresentPct}%` : hr ? `${hr.total_staff}` : '—'}
          subtitle={hr ? (attendanceIsOffDay ? 'OFF day' : (staffPresentPct != null ? `${hr.staff_on_leave_today || 0} on leave` : 'total staff')) : undefined}
          icon={icons.staff}
          color={attendanceIsOffDay ? 'gray' : 'purple'}
          href="/hr"
          loading={isModuleEnabled('hr') && loadingHR}
        />
      </div>

      {/* AI Insights */}
      <AIInsightsCard />

      {/* Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Left Column (3/5) */}
        <div className="lg:col-span-3 space-y-6">

          {/* Module Health Grid */}
          {moduleCards.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Module Overview</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {moduleCards.map(({ key, ...props }) => (
                  <ModuleHealthCard key={key} {...props} />
                ))}
              </div>
            </div>
          )}

          {/* Attendance Overview */}
          {isModuleEnabled('attendance') && report && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900">Today's Attendance</h2>
                <Link to="/attendance" className="text-xs text-sky-600 hover:text-sky-700 font-medium">View Details</Link>
              </div>
              {attendanceIsOffDay && (
                <div className="mb-3 inline-flex items-center gap-2 rounded-lg px-3 py-2 bg-gray-100 text-gray-700 text-xs font-semibold">
                  OFF day{report?.off_day_types?.length ? `: ${report.off_day_types.join(', ')}` : ''}
                </div>
              )}
              {/* Horizontal bar */}
              {!attendanceIsOffDay ? (
                <>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden flex">
                      {report.total_students > 0 && (
                        <>
                          <div
                            className="bg-green-500 h-full transition-all duration-500"
                            style={{ width: `${(report.present_count / report.total_students) * 100}%` }}
                          />
                          <div
                            className="bg-red-400 h-full transition-all duration-500"
                            style={{ width: `${(report.absent_count / report.total_students) * 100}%` }}
                          />
                        </>
                      )}
                    </div>
                    <span className="text-xs text-gray-500 shrink-0 tabular-nums">
                      {report.present_count}/{report.total_students}
                    </span>
                  </div>
                  <div className="flex gap-4 text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                      Present: {report.present_count}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                      Absent: {report.absent_count}
                    </span>
                    {pendingCount > 0 && (
                      <Link to="/attendance?tab=review" className="flex items-center gap-1.5 text-amber-600 hover:text-amber-700 font-medium">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                        {pendingCount} pending review
                      </Link>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-600">Attendance is not applicable today.</p>
              )}
            </div>
          )}

          {/* Finance Snapshot */}
          {isModuleEnabled('finance') && fin && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900">Finance — This Month</h2>
                <Link to="/finance" className="text-xs text-sky-600 hover:text-sky-700 font-medium">View Details</Link>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center p-3 bg-green-50 rounded-lg">
                  <p className="text-xs text-green-600 mb-0.5">Collected</p>
                  <p className="text-base font-bold text-green-700">Rs. {Number(fin.total_collected || 0).toLocaleString()}</p>
                </div>
                <div className="text-center p-3 bg-orange-50 rounded-lg">
                  <p className="text-xs text-orange-600 mb-0.5">Pending</p>
                  <p className="text-base font-bold text-orange-700">Rs. {Number(fin.total_pending || 0).toLocaleString()}</p>
                </div>
                <div className="text-center p-3 bg-blue-50 rounded-lg">
                  <p className="text-xs text-blue-600 mb-0.5">Collection Rate</p>
                  <p className="text-base font-bold text-blue-700">{collectionRate ?? 0}%</p>
                </div>
              </div>
            </div>
          )}

          {/* Session Health (below the fold) */}
          <SessionHealthWidget />

          {/* Attendance Risk (collapsed) */}
          <AttendanceRiskWidget />
        </div>

        {/* Right Column (2/5) */}
        <div className="lg:col-span-2 space-y-6">

          {/* Quick Actions */}
          <div>
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Quick Actions</h2>
            <QuickActionGrid actions={quickActions} />
          </div>

          {/* Notifications */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Recent Notifications</h2>
            <NotificationsFeed limit={5} />
          </div>
        </div>
      </div>
    </div>
  )
}


// ─── AI Insights Card (kept from original, enhanced grouping) ──────────────────

function AIInsightsCard() {
  const [expanded, setExpanded] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['aiInsights'],
    queryFn: () => tasksApi.getAIInsights(),
    refetchInterval: 5 * 60 * 1000,
  })

  const insights = data?.data?.insights || []

  if (isLoading || insights.length === 0) return null

  const typeStyles = {
    alert: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
  }

  const typeIcons = {
    alert: (
      <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
      </svg>
    ),
    warning: (
      <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    info: (
      <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  }

  const MODULE_COLORS = {
    attendance: 'bg-sky-100 text-sky-700',
    finance: 'bg-green-100 text-green-700',
    academics: 'bg-purple-100 text-purple-700',
    hr: 'bg-orange-100 text-orange-700',
  }

  const visible = expanded ? insights : insights.slice(0, 3)

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-900">AI Insights</h2>
          <span className="text-xs text-gray-400">{insights.length}</span>
        </div>
        {insights.length > 3 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-sky-600 hover:text-sky-700 font-medium"
          >
            {expanded ? 'Show less' : `Show all (${insights.length})`}
          </button>
        )}
      </div>
      <div className="space-y-2">
        {visible.map((insight, idx) => (
          <div key={idx} className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${typeStyles[insight.type] || typeStyles.info}`}>
            {typeIcons[insight.type] || typeIcons.info}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-sm font-medium">{insight.title}</p>
                {insight.module && (
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${MODULE_COLORS[insight.module] || 'bg-gray-100 text-gray-600'}`}>
                    {insight.module}
                  </span>
                )}
              </div>
              <p className="text-xs mt-0.5 opacity-80">{insight.detail}</p>
            </div>
            {insight.link && (
              <Link to={insight.link} className="text-xs font-medium underline shrink-0 hover:no-underline">
                {insight.action || 'View'}
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
