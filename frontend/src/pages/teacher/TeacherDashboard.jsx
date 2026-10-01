import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { academicsApi, attendanceApi, lmsApi, examinationsApi, sessionsApi } from '../../services/api'
import QuickActionGrid from '../../components/dashboard/QuickActionGrid'
import NotificationsFeed from '../../components/dashboard/NotificationsFeed'
import DashboardShell from '../../components/dashboard/DashboardShell'
import SectionCard from '../../components/dashboard/SectionCard'
import HeroCard from '../../components/dashboard/HeroCard'
import AttentionStrip from '../../components/dashboard/AttentionStrip'
import StudentsAtRiskCard from '../../components/dashboard/StudentsAtRiskCard'
import TeacherScopeSummary from '../../components/teacher/TeacherScopeSummary'
import useOffDay from '../../hooks/useOffDay'
import useNow from '../../hooks/useNow'
import {
  findPeriod, matchAssignment, sectionParams, manualEntryClassId,
  assignmentLabel, countOf, buildTeacherAttentionItems,
} from './teacherDashboardUtils'

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
  leave: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
}

export default function TeacherDashboard() {
  const { user, activeSchool, isModuleEnabled } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const now = useNow()
  const todayDay = DAY_NAMES[now.getDay()]
  const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const ayId = activeAcademicYear?.id

  const attendanceOn = isModuleEnabled('attendance')
  const academicsOn = isModuleEnabled('academics')
  const examsOn = isModuleEnabled('examinations')

  // Week range for lesson plans (Sunday → Saturday, local time)
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - now.getDay())
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const weekStartStr = fmt(weekStart)
  const weekEndStr = fmt(weekEnd)

  // ─── Queries ───────────────────────────────────────────────────────────

  const { isOffDay, label: offDayLabel } = useOffDay({ enabled: !!activeSchool?.id })

  const { data: timetableRes, isLoading: loadingTimetable, isError: timetableError } = useQuery({
    queryKey: ['myTimetable', todayDay, ayId],
    queryFn: () => academicsApi.getMyTimetable({
      day: todayDay,
      ...(ayId && { academic_year: ayId }),
    }),
  })
  const timetable = useMemo(() => timetableRes?.data || [], [timetableRes])

  const { data: classTeacherScopeRes, isLoading: loadingAssignments } = useQuery({
    queryKey: ['myClassTeacherAssignments', ayId],
    queryFn: () => academicsApi.getMyClassTeacherAssignments(ayId ? { academic_year: ayId } : undefined),
    enabled: academicsOn,
  })
  const assignments = useMemo(() => classTeacherScopeRes?.data || [], [classTeacherScopeRes])

  // Per-section progress. Counts come from page_size=1 list responses, and each
  // section is queried by session_class_id: the old page used the master class id,
  // which would blend 5-A and 5-B into one number for a sectioned class.
  const assignmentKey = assignments.map((a) => a.id).join(',')
  const { data: progress, isLoading: loadingProgress, isError: progressError } = useQuery({
    queryKey: ['teacherSectionProgress', todayDate, ayId, assignmentKey],
    queryFn: () => Promise.all(assignments.map(async (a) => {
      const params = sectionParams(a, ayId)
      try {
        const [enrollRes, recordsRes] = await Promise.all([
          sessionsApi.getEnrollments({ ...params, active_on: todayDate, page_size: 1 }),
          attendanceApi.getRecords({ ...params, date: todayDate, page_size: 1 }),
        ])
        return { assignment: a, total: countOf(enrollRes), marked: countOf(recordsRes), failed: false }
      } catch {
        return { assignment: a, total: null, marked: null, failed: true }
      }
    })),
    enabled: attendanceOn && assignments.length > 0,
  })
  const rows = useMemo(() => progress || [], [progress])
  const isPending = (r) => !r.failed && (r.total || 0) > 0 && (r.marked || 0) < r.total
  const pendingAttendanceClasses = rows.filter(isPending).length

  const { data: submissionsRes, isLoading: loadingSubmissions, isError: submissionsError } = useQuery({
    queryKey: ['pendingSubmissions'],
    queryFn: () => lmsApi.getSubmissions({ status: 'SUBMITTED', page_size: 10 }),
    enabled: academicsOn,
  })
  const submissions = submissionsRes?.data?.results || submissionsRes?.data || []
  const submissionCount = countOf(submissionsRes)

  // Class teachers only: the API scopes this to the teacher's own sections and returns
  // empty lists for a subject-only teacher. Fetched last and cached — it recomputes risk.
  const { data: riskRes, isLoading: loadingRisk, isError: riskError } = useQuery({
    queryKey: ['myStudentsAtRisk', ayId],
    queryFn: () => academicsApi.getMyStudentsAtRisk({ ...(ayId && { academic_year: ayId }), limit: 5 }),
    enabled: academicsOn && assignments.length > 0,
    staleTime: 10 * 60 * 1000,
  })
  const risk = riskRes?.data
  const studentsAtRisk = (risk?.attendance?.at_risk_count || 0) + (risk?.academic?.at_risk_count || 0)

  const { data: examsRes, isLoading: loadingExams, isError: examsError } = useQuery({
    queryKey: ['teacherExams', ayId],
    queryFn: () => examinationsApi.getExams({
      ...(ayId && { academic_year: ayId }),
      page_size: 10,
    }),
    enabled: examsOn,
  })
  const allExams = examsRes?.data?.results || examsRes?.data || []

  const { data: lessonPlansRes, isLoading: loadingPlans, isError: plansError } = useQuery({
    queryKey: ['weekLessonPlans', weekStartStr, weekEndStr],
    queryFn: () => lmsApi.getLessonPlans({ date_from: weekStartStr, date_to: weekEndStr, page_size: 30 }),
    enabled: academicsOn,
  })
  const weekPlans = lessonPlansRes?.data?.results || lessonPlansRes?.data || []

  // ─── Derived ───────────────────────────────────────────────────────────

  const period = useMemo(() => findPeriod(timetable, now), [timetable, now])
  const heroEntry = period.index >= 0 ? timetable[period.index] : null
  const heroAssignment = matchAssignment(heroEntry, assignments)
  const heroRow = heroAssignment ? rows.find((r) => r.assignment.id === heroAssignment.id) : null

  const upcomingExams = useMemo(
    () => allExams.filter((e) => e.status === 'SCHEDULED' || e.status === 'PUBLISHED').slice(0, 5),
    [allExams],
  )
  const examsAwaitingMarks = allExams.filter((e) => e.status === 'PUBLISHED').length

  const lessonPlanStats = useMemo(() => {
    const total = weekPlans.length
    const completed = weekPlans.filter((p) => p.status === 'COMPLETED' || p.is_completed).length
    const published = weekPlans.filter((p) => p.status === 'PUBLISHED').length
    return { total, completed, published }
  }, [weekPlans])

  const attentionItems = buildTeacherAttentionItems({
    isOffDay, attendanceOn, examsOn, academicsOn,
    pendingAttendanceClasses,
    submissionsToGrade: submissionCount,
    examsAwaitingMarks,
    studentsAtRisk,
  })
  const attentionLoading = (attendanceOn && (loadingAssignments || loadingProgress))
    || (academicsOn && loadingSubmissions) || (examsOn && loadingExams)

  const quickActions = [
    ...(attendanceOn ? [{ label: 'Mark Attendance', href: '/attendance/manual-entry', icon: icons.attendance, badge: isOffDay ? 0 : pendingAttendanceClasses }] : []),
    { label: 'My Timetable', href: '/academics/timetable', icon: icons.timetable },
    ...(academicsOn ? [
      { label: 'Lesson Plans', href: '/academics/lesson-plans', icon: icons.lessonPlan },
      { label: 'Assignments', href: '/academics/assignments', icon: icons.assignments, badge: submissionCount || 0 },
    ] : []),
    ...(examsOn ? [{ label: 'Enter Marks', href: '/academics/marks-entry', icon: icons.marks, badge: examsAwaitingMarks }] : []),
    ...(isModuleEnabled('hr') ? [{ label: 'My Leave', href: '/hr/leave', icon: icons.leave }] : []),
    { label: 'Notifications', href: '/notifications', icon: icons.notify },
  ]

  // ─── Hero ──────────────────────────────────────────────────────────────

  let hero
  if (isOffDay) {
    hero = <HeroCard tone="gray" eyebrow="Today" title="No school today" subtitle={offDayLabel} />
  } else if (loadingTimetable) {
    hero = <div className="mb-6 h-24 rounded-xl bg-gray-50 border border-gray-100 animate-pulse" />
  } else if (timetable.length === 0) {
    hero = <HeroCard tone="gray" eyebrow="Today" title="No classes scheduled today" />
  } else if (!heroEntry) {
    hero = <HeroCard tone="green" eyebrow="Today" title="All classes done for today" subtitle={`${timetable.length} period${timetable.length === 1 ? '' : 's'} taught`} />
  } else {
    const times = `${heroEntry.slot_start_time?.slice(0, 5)} – ${heroEntry.slot_end_time?.slice(0, 5)}`
    const inMinutes = period.minutes
    const eyebrow = period.state === 'now'
      ? `Now · ${inMinutes} min left`
      : `Next · starts in ${inMinutes >= 60 ? `${Math.floor(inMinutes / 60)}h ${inMinutes % 60}m` : `${inMinutes} min`}`
    const unmarked = heroRow ? isPending(heroRow) : false
    hero = (
      <HeroCard
        tone={period.state === 'now' ? 'sky' : 'gray'}
        eyebrow={eyebrow}
        title={`${heroEntry.subject_name || 'Free Period'} — ${heroEntry.class_name}`}
        subtitle={`${times}${heroEntry.room ? ` · ${heroEntry.room}` : ''}`}
        primaryAction={attendanceOn && heroAssignment
          ? {
            label: unmarked ? 'Mark attendance' : 'View attendance',
            href: `/attendance/manual-entry?class=${manualEntryClassId(heroAssignment)}`,
          }
          : undefined}
      />
    )
  }

  // ─── Render ────────────────────────────────────────────────────────────

  const displayName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username

  return (
    <DashboardShell
      title="Dashboard"
      subtitle={`Welcome back, ${displayName}`}
      offDayLabel={offDayLabel}
    >
      <AttentionStrip items={attentionItems} loading={attentionLoading} />

      {hero}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left column */}
        <div className="lg:col-span-3 space-y-6">
          <SectionCard
            title="Today's Timetable"
            action={{ label: 'Full Timetable', href: '/academics/timetable' }}
            loading={loadingTimetable}
            error={timetableError}
            empty={timetable.length === 0}
            emptyText="No classes scheduled today"
          >
            {isOffDay && (
              <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                {offDayLabel} — school is not in session today. Periods below are the regular weekly schedule and won't run.
              </div>
            )}
            <div className="space-y-1.5">
              {timetable.map((entry, idx) => {
                const isCurrent = !isOffDay && period.state === 'now' && idx === period.index
                return (
                  <div
                    key={entry.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                      isCurrent ? 'bg-sky-50 border border-sky-200' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="w-20 shrink-0">
                      <p className={`text-xs font-medium tabular-nums ${isCurrent ? 'text-sky-700' : 'text-gray-500'}`}>
                        {entry.slot_start_time?.slice(0, 5)} - {entry.slot_end_time?.slice(0, 5)}
                      </p>
                      {isCurrent && <span className="text-[10px] font-semibold text-sky-600 uppercase">Now</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${isCurrent ? 'text-sky-800' : 'text-gray-800'}`}>
                        {entry.subject_name || 'Free Period'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {entry.class_name}
                        {entry.room && <span className="ml-1.5 text-gray-400">| {entry.room}</span>}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400 shrink-0">{entry.slot_name}</span>
                  </div>
                )
              })}
            </div>
          </SectionCard>

          {attendanceOn && (
            <SectionCard
              title="Attendance by Section"
              action={{ label: 'Mark Attendance', href: '/attendance/manual-entry' }}
              loading={loadingAssignments || loadingProgress}
              error={progressError}
              empty={assignments.length === 0}
              emptyText="No class-teacher assignments in the current academic year."
            >
              {isOffDay && <p className="mb-2 text-xs text-gray-500">{offDayLabel} — nothing to mark today.</p>}
              <div className="space-y-1.5">
                {rows.map((r) => {
                  const pending = isPending(r)
                  return (
                    <Link
                      key={r.assignment.id}
                      to={`/attendance/manual-entry?class=${manualEntryClassId(r.assignment)}`}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-gray-50"
                    >
                      <span className="text-sm text-gray-800 truncate">{assignmentLabel(r.assignment)}</span>
                      {r.failed ? (
                        <span className="text-xs text-red-600">Couldn't load</span>
                      ) : (
                        <span className={`text-sm font-semibold tabular-nums ${
                          isOffDay ? 'text-gray-400' : pending ? 'text-amber-700' : 'text-green-700'
                        }`}>
                          {r.marked || 0}/{r.total || 0}
                          {!isOffDay && !pending && (r.total || 0) > 0 && <span className="ml-1 text-xs font-normal">marked</span>}
                        </span>
                      )}
                    </Link>
                  )
                })}
              </div>
            </SectionCard>
          )}

          {examsOn && (
            <SectionCard
              title="Exams & Marks Entry"
              action={{ label: 'View All', href: '/academics/exams' }}
              loading={loadingExams}
              error={examsError}
              empty={upcomingExams.length === 0}
              emptyText="No upcoming exams."
            >
              <div className="space-y-2">
                {upcomingExams.map((exam) => (
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
                        <Link to={`/academics/marks-entry?exam=${exam.id}`} className="text-xs text-sky-600 hover:text-sky-700 font-medium">
                          Enter Marks
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {academicsOn && (
            <SectionCard
              title="Submissions Needing Grading"
              action={{ label: 'View All', href: '/academics/assignments' }}
              loading={loadingSubmissions}
              error={submissionsError}
              empty={submissions.length === 0}
              emptyText="Nothing waiting to be graded."
            >
              <div className="space-y-1.5">
                {submissions.slice(0, 5).map((sub) => (
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
            </SectionCard>
          )}
          {academicsOn && assignments.length > 0 && (
            <StudentsAtRiskCard data={risk} loading={loadingRisk} error={riskError} />
          )}
        </div>

        {/* Right column */}
        <div className="lg:col-span-2 space-y-6">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Quick Actions</h2>
            <QuickActionGrid actions={quickActions} />
          </div>

          {academicsOn && (
            <SectionCard
              title="Lesson Plans This Week"
              action={{ label: 'View All', href: '/academics/lesson-plans' }}
              loading={loadingPlans}
              error={plansError}
              empty={lessonPlanStats.total === 0}
              emptyText="No lesson plans this week"
            >
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
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> {lessonPlanStats.completed} completed</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" /> {lessonPlanStats.published} published</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300" /> {lessonPlanStats.total - lessonPlanStats.completed - lessonPlanStats.published} draft</span>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
                {weekPlans.slice(0, 4).map((plan) => (
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
            </SectionCard>
          )}

          <div className="card">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Notifications</h2>
            <NotificationsFeed limit={5} />
          </div>
        </div>
      </div>

      {academicsOn && (
        <details className="mt-8 group">
          <summary className="cursor-pointer select-none px-4 py-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm font-semibold text-gray-900">
            My teaching scope
            <span className="ml-2 text-xs font-normal text-gray-500">class-teacher and subject-teacher assignments</span>
          </summary>
          <div className="mt-3"><TeacherScopeSummary compact /></div>
        </details>
      )}
    </DashboardShell>
  )
}
