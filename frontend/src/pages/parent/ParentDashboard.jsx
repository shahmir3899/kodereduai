import { useQuery, useQueries } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { parentsApi } from '../../services/api'
import DashboardShell from '../../components/dashboard/DashboardShell'
import AttentionStrip from '../../components/dashboard/AttentionStrip'
import NotificationsFeed from '../../components/dashboard/NotificationsFeed'
import QuickActionGrid from '../../components/dashboard/QuickActionGrid'
import Spinner from '../../components/ui/Spinner'
import PhotoAvatar from '../../components/ui/PhotoAvatar'
import {
  readOverview, buildParentAttentionItems, formatPkr, daysUntil, parseLocalDate,
} from './parentOverviewUtils'

const Icon = ({ d }) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={d} />
  </svg>
)
const ICONS = {
  leave: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  messages: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  fees: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
  profile: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
}

const STATUS_PILL = {
  PRESENT: 'bg-green-100 text-green-700',
  ABSENT: 'bg-red-100 text-red-700',
  LATE: 'bg-amber-100 text-amber-700',
  LEAVE: 'bg-blue-100 text-blue-700',
}
const DOT = { PRESENT: 'bg-green-500', ABSENT: 'bg-red-500', LATE: 'bg-amber-500', LEAVE: 'bg-blue-500' }

const rateColor = (r) => (r == null ? 'text-gray-400' : r >= 75 ? 'text-green-600' : r >= 60 ? 'text-yellow-600' : 'text-red-600')
const scoreColor = (p) => (p == null ? 'text-gray-400' : p >= 60 ? 'text-green-600' : p >= 40 ? 'text-yellow-600' : 'text-red-600')

export default function ParentDashboard() {
  const { user } = useAuth()

  const { data: childrenData, isLoading, isError } = useQuery({
    queryKey: ['myChildren'],
    queryFn: () => parentsApi.getMyChildren(),
  })
  const children = childrenData?.data?.results || childrenData?.data || []

  // One overview per child, fetched here (not inside each card) so the attention
  // strip can summarise every child. Same key as the child Overview page.
  const overviews = useQueries({
    queries: children.map((c) => ({
      queryKey: ['childOverview', String(c.student)],
      queryFn: () => parentsApi.getChildOverview(c.student),
      staleTime: 5 * 60 * 1000,
    })),
  })

  const { data: threadsRes } = useQuery({
    queryKey: ['parentMessageThreads'],
    queryFn: () => parentsApi.getMessageThreads(),
    staleTime: 60 * 1000,
  })
  const threads = threadsRes?.data?.results || threadsRes?.data || []
  const unreadMessages = threads.reduce((sum, t) => sum + (t.unread_count || 0), 0)

  const rows = children.map((child, i) => ({
    child,
    loading: overviews[i]?.isLoading,
    error: overviews[i]?.isError,
    vm: overviews[i]?.data ? readOverview(overviews[i].data.data, child) : null,
  }))

  const attentionItems = buildParentAttentionItems(
    rows.map(({ child, vm }) => ({ studentId: child.student, vm })),
    { unreadMessages },
  )
  const attentionLoading = rows.some((r) => r.loading)

  const quickActions = [
    { label: 'Apply Leave', href: '/parent/leave', icon: <Icon d={ICONS.leave} /> },
    { label: 'Messages', href: '/parent/messages', icon: <Icon d={ICONS.messages} />, badge: unreadMessages },
    // Which child's fees? Only unambiguous with one child.
    ...(children.length === 1
      ? [{ label: 'Fees', href: `/parent/children/${children[0].student}/fees`, icon: <Icon d={ICONS.fees} /> }]
      : []),
    { label: 'My Profile', href: '/profile', icon: <Icon d={ICONS.profile} /> },
  ]

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="md" />
      </div>
    )
  }

  return (
    <DashboardShell
      title="Dashboard"
      subtitle={`Welcome back, ${user?.first_name || user?.username}${children.length > 0 ? ` · ${children.length} ${children.length === 1 ? 'child' : 'children'} linked` : ''}`}
    >
      {isError ? (
        <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Couldn't load your children. Try refreshing the page.
        </div>
      ) : children.length === 0 ? (
        <div className="mb-6 bg-white rounded-xl border border-gray-200 p-10 text-center">
          <h3 className="text-base font-medium text-gray-900 mb-1">No children linked</h3>
          <p className="text-sm text-gray-500">Contact the school administrator to link your children to your account.</p>
        </div>
      ) : (
        <>
          <AttentionStrip items={attentionItems} loading={attentionLoading} />
          <div className="space-y-4 mb-6">
            {rows.map(({ child, vm, loading, error }) => (
              <ChildCard key={child.id} child={child} vm={vm} loading={loading} error={error} />
            ))}
          </div>
        </>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3">
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
            <h3 className="text-base font-semibold text-gray-900 mb-3">Quick Actions</h3>
            <QuickActionGrid actions={quickActions} />
          </div>
        </div>
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
            <h3 className="text-base font-semibold text-gray-900 mb-3">Notifications</h3>
            <NotificationsFeed limit={5} />
          </div>
        </div>
      </div>
    </DashboardShell>
  )
}

function Tile({ label, loading, children }) {
  return (
    <div className="p-3 bg-gray-50 rounded-lg min-w-0">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      {loading ? <div className="h-5 bg-gray-200 rounded w-16 animate-pulse" /> : children}
    </div>
  )
}

// '' is the child's overview page; nothing else linked to it, so parents could not reach it from the dashboard.
const LINKS = [
  ['', 'Overview'], ['attendance', 'Attendance'], ['fees', 'Fees'], ['results', 'Results'],
  ['timetable', 'Timetable'], ['exam-schedule', 'Exam Schedule'], ['library', 'Library'], ['transport', 'Transport'],
]

/** Per-child card. `vm` is readOverview()'s output (null until the overview loads). */
function ChildCard({ child, vm, loading, error }) {
  const base = `/parent/children/${child.student}`
  const name = vm?.name || child.student_name
  const className = vm?.className || child.class_name

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 flex items-center gap-3 border-b border-gray-100">
        <PhotoAvatar url={child.student_photo_url} name={name} className="w-11 h-11" textClassName="text-lg" />
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-gray-900 truncate">{name}</h3>
          <p className="text-sm text-gray-500">
            {className || 'Class N/A'}
            {(vm?.rollNumber || child.student_roll_number) ? ` · Roll #${vm?.rollNumber || child.student_roll_number}` : ''}
          </p>
        </div>
        {vm && (
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${
            vm.isOffDay ? 'bg-gray-100 text-gray-700' : (STATUS_PILL[vm.todayStatus] || 'bg-gray-100 text-gray-500')
          }`}>
            {vm.isOffDay ? vm.offDayLabel : `Today: ${vm.todayLabel}`}
          </span>
        )}
      </div>

      {error ? (
        <p role="alert" className="px-5 py-4 text-sm text-red-600">Couldn't load {name}'s summary. Try refreshing the page.</p>
      ) : (
        <div className="px-5 py-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile label="Attendance" loading={loading}>
            <p className={`text-lg font-bold ${rateColor(vm?.attendanceRate)}`}>
              {vm?.attendanceRate != null ? `${vm.attendanceRate}%` : 'No records'}
            </p>
            {vm?.totalDays > 0 && <p className="text-xs text-gray-500">{vm.presentDays} of {vm.totalDays} days</p>}
            {vm?.recent?.length > 0 && (
              <div className="flex gap-1 mt-1.5" aria-label="Last marked days">
                {vm.recent.map((r) => (
                  <span key={r.date} title={`${r.date}: ${r.status}`} className={`w-2 h-2 rounded-full ${DOT[r.status] || 'bg-gray-300'}`} />
                ))}
              </div>
            )}
          </Tile>

          <Tile label="Fees" loading={loading}>
            {vm?.outstanding > 0 ? (
              <>
                <p className="text-lg font-bold text-red-600">{formatPkr(vm.outstanding)}</p>
                <p className="text-xs text-gray-500">{vm.overdue > 0 ? `${formatPkr(vm.overdue)} from earlier months` : 'outstanding'}</p>
              </>
            ) : (
              <p className="text-lg font-bold text-green-600">Nothing due</p>
            )}
          </Tile>

          <Tile label="Last Exam" loading={loading}>
            {vm?.latestExam ? (
              <>
                <p className={`text-lg font-bold ${scoreColor(vm.latestExam.percentage)}`}>
                  {Math.round(vm.latestExam.percentage)}%
                  {vm.examDelta != null && vm.examDelta !== 0 && (
                    <span className={`ml-1 text-xs font-semibold ${vm.examDelta > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {vm.examDelta > 0 ? '▲' : '▼'} {Math.abs(vm.examDelta)}
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-500 truncate">{vm.latestExam.name}</p>
              </>
            ) : (
              <p className="text-sm font-medium text-gray-400">No results yet</p>
            )}
          </Tile>

          <Tile label="Next Exam" loading={loading}>
            {vm?.nextExam ? (
              <>
                <p className="text-sm font-bold text-gray-900 truncate">{vm.nextExam.subject_name}</p>
                <p className="text-xs text-gray-500">{nextExamWhen(vm.nextExam.exam_date)}</p>
              </>
            ) : (
              <p className="text-sm font-medium text-gray-400">None scheduled</p>
            )}
          </Tile>
        </div>
      )}

      <div className="px-5 py-3 border-t border-gray-100 flex flex-wrap gap-2">
        {LINKS.map(([path, label]) => (
          <Link
            key={path}
            to={path ? `${base}/${path}` : base}
            className="text-xs font-medium text-gray-600 hover:text-primary-600 bg-gray-50 hover:bg-primary-50 px-3 py-1.5 rounded-md transition-colors"
          >
            {label}
          </Link>
        ))}
        <Link
          to="/parent/leave"
          className="text-xs font-medium text-gray-600 hover:text-amber-600 bg-gray-50 hover:bg-amber-50 px-3 py-1.5 rounded-md transition-colors"
        >
          Apply Leave
        </Link>
      </div>
    </div>
  )
}

function nextExamWhen(iso) {
  const days = daysUntil(iso)
  const date = parseLocalDate(iso)
  const pretty = date ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : iso
  if (days === 0) return `Today · ${pretty}`
  if (days === 1) return `Tomorrow · ${pretty}`
  return days != null && days > 0 ? `In ${days} days · ${pretty}` : pretty
}
