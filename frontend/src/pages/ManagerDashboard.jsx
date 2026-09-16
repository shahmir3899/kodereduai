import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { lmsApi, examinationsApi } from '../services/api'
import QuickActionGrid from '../components/dashboard/QuickActionGrid'
import StatCard from '../components/dashboard/StatCard'
import NotificationsFeed from '../components/dashboard/NotificationsFeed'

// ─── Icons ──────────────────────────────────────────────────────────────────────
const icons = {
  lessonPlan: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  ),
  assignment: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  questionBank: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  paper: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m-9 8h12a2 2 0 002-2V5a2 2 0 00-2-2H6a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  ),
}

export default function ManagerDashboard() {
  const { user } = useAuth()

  // ─── Queries ──────────────────────────────────────────────────────────────────
  // Content-side counts only — HR/Attendance/Payroll data and the
  // Planning & Delivery-linked tiles were removed 2026-09 alongside
  // Manager's nav access, which is now scoped to Dashboard/Academics/
  // Content Creation/Management only (see Layout.jsx and hr/permissions.py).

  const { data: lessonPlansRes, isLoading: loadingLessonPlans } = useQuery({
    queryKey: ['managerLessonPlansCount'],
    queryFn: () => lmsApi.getLessonPlans({ page_size: 1 }),
  })
  const lessonPlansCount = lessonPlansRes?.data?.count ?? 0

  const { data: activeAssignmentsRes, isLoading: loadingAssignments } = useQuery({
    queryKey: ['managerActiveAssignmentsCount'],
    queryFn: () => lmsApi.getAssignments({ status: 'PUBLISHED', page_size: 1 }),
  })
  const activeAssignmentsCount = activeAssignmentsRes?.data?.count ?? 0

  const { data: questionBankRes, isLoading: loadingQuestions } = useQuery({
    queryKey: ['managerQuestionBankCount'],
    queryFn: () => examinationsApi.getQuestions({ page_size: 1 }),
  })
  const questionBankCount = questionBankRes?.data?.count ?? 0

  const { data: examPapersRes, isLoading: loadingExamPapers } = useQuery({
    queryKey: ['managerExamPapersCount'],
    queryFn: () => examinationsApi.getExamPapers({ page_size: 1 }),
  })
  const examPapersCount = examPapersRes?.data?.count ?? 0

  // ─── Quick Actions ──────────────────────────────────────────────────────────

  const quickActions = [
    { label: 'Question Bank', href: '/academics/questions', icon: icons.questionBank },
    { label: 'Paper Builder', href: '/academics/paper-builder', icon: icons.paper },
    { label: 'Assignments', href: '/academics/assignments', icon: icons.assignment },
  ]

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Manager Dashboard</h1>
        <p className="text-sm text-gray-500">
          Welcome back, {[user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username}
        </p>
      </div>

      {/* KPI Stats — Content (LMS / exam content) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Lesson Plans"
          value={lessonPlansCount}
          icon={icons.lessonPlan}
          color="sky"
          loading={loadingLessonPlans}
        />
        <StatCard
          label="Active Assignments"
          value={activeAssignmentsCount}
          icon={icons.assignment}
          color="blue"
          href="/academics/assignments"
          loading={loadingAssignments}
        />
        <StatCard
          label="Question Bank"
          value={questionBankCount}
          icon={icons.questionBank}
          color="green"
          href="/academics/questions"
          loading={loadingQuestions}
        />
        <StatCard
          label="Exam Papers"
          value={examPapersCount}
          icon={icons.paper}
          color="purple"
          href="/academics/papers"
          loading={loadingExamPapers}
        />
      </div>

      {/* Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Left Column */}
        <div className="lg:col-span-3 space-y-6">
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-900 mb-2">Classes</h2>
            <p className="text-sm text-gray-500">
              See <Link to="/classes" className="text-sky-600 hover:text-sky-700 font-medium">Classes</Link> and{' '}
              <Link to="/students" className="text-sky-600 hover:text-sky-700 font-medium">Students</Link> under Management.
            </p>
          </div>
        </div>

        {/* Right Column */}
        <div className="lg:col-span-2 space-y-6">

          {/* Quick Actions */}
          <div>
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Quick Actions</h2>
            <QuickActionGrid actions={quickActions} />
          </div>

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
