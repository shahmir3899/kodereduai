import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { academicsApi, attendanceApi, lmsApi, examinationsApi } from '../../services/api'
import StatCard from '../../components/dashboard/StatCard'
import QuickActionGrid from '../../components/dashboard/QuickActionGrid'
import NotificationsFeed from '../../components/dashboard/NotificationsFeed'

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

// ─── Icons ──────────────────────────────────────────────────────────────────────
const icons = {
  classes: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  ),
  attendance: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  grading: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  ),
  exams: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  timetable: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  lessonPlan: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  ),
  assignments: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  ),
  marks: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  notify: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  ),
}

export default function TeacherDashboard() {
  const { user, isModuleEnabled } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const now = new Date()
  const todayDay = DAY_NAMES[now.getDay()]

  // Detect current period
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  // Week date range for lesson plans
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - now.getDay())
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  const weekStartStr = weekStart.toISOString().split('T')[0]
  const weekEndStr = weekEnd.toISOString().split('T')[0]

  // ─── Queries ──────────────────────────────────────────────────────────────────

  // Today's timetable
  const { data: timetableRes, isLoading: loadingTimetable } = useQuery({
    queryKey: ['myTimetable', todayDay, activeAcademicYear?.id],
    queryFn: () => academicsApi.getMyTimetable({
      day: todayDay,
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
    }),
  })
  const timetable = timetableRes?.data || []

  // Classes needing attendance
  const { data: myClassesRes } = useQuery({
    queryKey: ['myAttendanceClasses'],
    queryFn: () => attendanceApi.getMyAttendanceClasses(),
    enabled: isModuleEnabled('attendance'),
  })
  const myClasses = myClassesRes?.data || []

  // Submissions needing grading
  const { data: submissionsRes } = useQuery({
    queryKey: ['pendingSubmissions'],
    queryFn: () => lmsApi.getSubmissions({ status: 'SUBMITTED', page_size: 10 }),
    enabled: isModuleEnabled('academics'),
  })
  const submissions = submissionsRes?.data?.results || submissionsRes?.data || []

  // Upcoming exams (for teacher's subjects)
  const { data: examsRes } = useQuery({
    queryKey: ['teacherExams', activeAcademicYear?.id],
    queryFn: () => examinationsApi.getExams({
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
      page_size: 10,
    }),
    enabled: isModuleEnabled('examinations'),
  })
  const allExams = examsRes?.data?.results || examsRes?.data || []

  // Lesson plans this week
  const { data: lessonPlansRes } = useQuery({
    queryKey: ['weekLessonPlans', weekStartStr, weekEndStr],
    queryFn: () => lmsApi.getLessonPlans({
      date_from: weekStartStr,
      date_to: weekEndStr,
      page_size: 30,
    }),
    enabled: isModuleEnabled('academics'),
  })
  const weekPlans = lessonPlansRes?.data?.results || lessonPlansRes?.data || []

  // ─── Computed ─────────────────────────────────────────────────────────────────

  // Find current/next period
  const currentPeriodIdx = useMemo(() => {
    if (!timetable.length) return -1
    for (let i = 0; i < timetable.length; i++) {
      const start = timetable[i].slot_start_time?.slice(0, 5)
      const end = timetable[i].slot_end_time?.slice(0, 5)
      if (start && end && currentTime >= start && currentTime <= end) return i
    }
    // If between periods, find next upcoming
    for (let i = 0; i < timetable.length; i++) {
      const start = timetable[i].slot_start_time?.slice(0, 5)
      if (start && currentTime < start) return i
    }
    return -1
  }, [timetable, currentTime])

  // Exams needing marks entry (PUBLISHED status usually means marks can be entered)
  const upcomingExams = useMemo(() => {
    return allExams
      .filter(e => e.status === 'SCHEDULED' || e.status === 'PUBLISHED')
      .slice(0, 5)
  }, [allExams])

  // Lesson plan stats
  const lessonPlanStats = useMemo(() => {
    const total = weekPlans.length
    const completed = weekPlans.filter(p => p.status === 'COMPLETED' || p.is_completed).length
    const published = weekPlans.filter(p => p.status === 'PUBLISHED').length
    return { total, completed, published }
  }, [weekPlans])

  // ─── Quick Actions ──────────────────────────────────────────────────────────

  const quickActions = [
    ...(isModuleEnabled('attendance') ? [{ label: 'Mark Attendance', href: '/attendance/manual-entry', icon: icons.attendance }] : []),
    { label: 'My Timetable', href: '/academics/timetable', icon: icons.timetable },
    ...(isModuleEnabled('academics') ? [
      { label: 'Lesson Plans', href: '/academics/lesson-plans', icon: icons.lessonPlan },
      { label: 'Assignments', href: '/academics/assignments', icon: icons.assignments },
    ] : []),
    ...(isModuleEnabled('examinations') ? [{ label: 'Enter Marks', href: '/academics/marks-entry', icon: icons.marks }] : []),
    { label: 'Notifications', href: '/notifications', icon: icons.notify },
  ]

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">
          Welcome back, {[user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username}
          <span className="text-gray-400 ml-1">— {todayDay}, {now.toLocaleDateString('default', { month: 'long', day: 'numeric' })}</span>
        </p>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Classes Today"
          value={timetable.length}
          subtitle={currentPeriodIdx >= 0 ? `Now: ${timetable[currentPeriodIdx]?.subject_name || 'Class'}` : undefined}
          icon={icons.classes}
          color="blue"
          loading={loadingTimetable}
        />
        <StatCard
          label="Attendance to Mark"
          value={myClasses.length}
          subtitle={myClasses.length > 0 ? 'classes pending' : 'all marked'}
          icon={icons.attendance}
          color={myClasses.length > 0 ? 'amber' : 'green'}
          href="/attendance/manual-entry"
        />
        <StatCard
          label="Pending Grading"
          value={submissions.length}
          subtitle="submissions"
          icon={icons.grading}
          color={submissions.length > 0 ? 'red' : 'green'}
          href="/academics/assignments"
        />
        <StatCard
          label="Upcoming Exams"
          value={upcomingExams.length}
          subtitle={upcomingExams.length > 0 ? 'need attention' : 'none scheduled'}
          icon={icons.exams}
          color={upcomingExams.length > 0 ? 'purple' : 'gray'}
          href="/academics/exams"
        />
      </div>

      {/* Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Left Column */}
        <div className="lg:col-span-3 space-y-6">

          {/* Today's Timetable */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900">Today's Timetable</h2>
              <Link to="/academics/timetable" className="text-xs text-sky-600 hover:text-sky-700 font-medium">Full Timetable</Link>
            </div>
            {loadingTimetable ? (
              <div className="space-y-2 animate-pulse">
                {[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-gray-50 rounded-lg" />)}
              </div>
            ) : timetable.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No classes scheduled today</p>
            ) : (
              <div className="space-y-1.5">
                {timetable.map((entry, idx) => {
                  const isCurrent = idx === currentPeriodIdx
                  return (
                    <div
                      key={entry.id}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                        isCurrent ? 'bg-sky-50 border border-sky-200' : 'hover:bg-gray-50'
                      }`}
                    >
                      {/* Time */}
                      <div className="w-20 shrink-0">
                        <p className={`text-xs font-medium tabular-nums ${isCurrent ? 'text-sky-700' : 'text-gray-500'}`}>
                          {entry.slot_start_time?.slice(0, 5)} - {entry.slot_end_time?.slice(0, 5)}
                        </p>
                        {isCurrent && <span className="text-[10px] font-semibold text-sky-600 uppercase">Now</span>}
                      </div>
                      {/* Details */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${isCurrent ? 'text-sky-800' : 'text-gray-800'}`}>
                          {entry.subject_name || 'Free Period'}
                        </p>
                        <p className="text-xs text-gray-500">
                          {entry.class_name}
                          {entry.room && <span className="ml-1.5 text-gray-400">| {entry.room}</span>}
                        </p>
                      </div>
                      {/* Period name */}
                      <span className="text-xs text-gray-400 shrink-0">{entry.slot_name}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Exams & Marks Entry */}
          {isModuleEnabled('examinations') && upcomingExams.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900">Exams & Marks Entry</h2>
                <Link to="/academics/exams" className="text-xs text-sky-600 hover:text-sky-700 font-medium">View All</Link>
              </div>
              <div className="space-y-2">
                {upcomingExams.map(exam => (
                  <div key={exam.id} className="flex items-center justify-between py-2.5 px-3 bg-gray-50 rounded-lg">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800">{exam.name}</p>
                      <p className="text-xs text-gray-500">
                        {exam.class_name && <span>{exam.class_name}</span>}
                        {exam.start_date && <span className="ml-1.5">| {new Date(exam.start_date).toLocaleDateString('default', { month: 'short', day: 'numeric' })}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        exam.status === 'PUBLISHED' ? 'bg-green-100 text-green-700'
                          : exam.status === 'SCHEDULED' ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-600'
                      }`}>
                        {exam.status}
                      </span>
                      {exam.status === 'PUBLISHED' && (
                        <Link
                          to={`/academics/marks-entry?exam=${exam.id}`}
                          className="text-xs text-sky-600 hover:text-sky-700 font-medium"
                        >
                          Enter Marks
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Submissions Needing Grading */}
          {submissions.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900">Submissions Needing Grading</h2>
                <Link to="/academics/assignments" className="text-xs text-sky-600 hover:text-sky-700 font-medium">View All</Link>
              </div>
              <div className="space-y-1.5">
                {submissions.slice(0, 5).map(sub => (
                  <div key={sub.id} className="flex items-center justify-between py-2 px-2.5 hover:bg-gray-50 rounded-lg transition-colors">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800">{sub.student_name || 'Student'}</p>
                      <p className="text-xs text-gray-500">{sub.assignment_title || 'Assignment'}</p>
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">
                      {sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString() : ''}
                    </span>
                  </div>
                ))}
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

          {/* Lesson Plans This Week */}
          {isModuleEnabled('academics') && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900">Lesson Plans This Week</h2>
                <Link to="/academics/lesson-plans" className="text-xs text-sky-600 hover:text-sky-700 font-medium">View All</Link>
              </div>
              {lessonPlanStats.total === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No lesson plans this week</p>
              ) : (
                <div>
                  {/* Progress bar */}
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full transition-all duration-500"
                        style={{ width: `${(lessonPlanStats.completed / lessonPlanStats.total) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium text-gray-600 tabular-nums">
                      {lessonPlanStats.completed}/{lessonPlanStats.total}
                    </span>
                  </div>
                  <div className="flex gap-3 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-green-500" /> {lessonPlanStats.completed} completed
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-blue-400" /> {lessonPlanStats.published} published
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-gray-300" /> {lessonPlanStats.total - lessonPlanStats.completed - lessonPlanStats.published} draft
                    </span>
                  </div>
                  {/* Recent plans */}
                  {weekPlans.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
                      {weekPlans.slice(0, 4).map(plan => (
                        <div key={plan.id} className="flex items-center justify-between py-1">
                          <div className="min-w-0">
                            <p className="text-sm text-gray-700 truncate">{plan.title || plan.topic || 'Lesson Plan'}</p>
                            <p className="text-xs text-gray-400">{plan.subject_name || ''} {plan.class_name ? `— ${plan.class_name}` : ''}</p>
                          </div>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ml-2 ${
                            plan.status === 'COMPLETED' || plan.is_completed ? 'bg-green-100 text-green-700'
                              : plan.status === 'PUBLISHED' ? 'bg-blue-100 text-blue-700'
                                : 'bg-gray-100 text-gray-500'
                          }`}>
                            {plan.status === 'COMPLETED' || plan.is_completed ? 'Done' : plan.status || 'Draft'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
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
