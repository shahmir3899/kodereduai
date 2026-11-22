import { useState } from 'react'
import Button from '../../components/ui/Button'
import { useToast } from '../../components/Toast'
import { useQuery } from '@tanstack/react-query'
import { teacherPerformanceApi } from '../../services/api'
import PageHeader from '../../components/ui/PageHeader'
import LoadingState from '../../components/ui/LoadingState'
import ErrorState from '../../components/ui/ErrorState'
import EmptyState from '../../components/ui/EmptyState'
import { Avatar, CardGrid, RecordCard, StatusPill, ViewToggle } from '../../components/cards'
import { useViewPreference } from '../../hooks/useViewPreference'
import { THEAD, TBODY, TR, th, td } from '../../components/ui/tableStyles'
import PerformanceInfo from '../../components/teacher/PerformanceInfo'
import TeacherPerformanceDetail from './teacherPerformance/TeacherPerformanceDetail'
import TeacherPerformanceSettings from './teacherPerformance/TeacherPerformanceSettings'
import PeriodPicker, { usePeriod } from './teacherPerformance/PeriodPicker'
import { bandTone, formatScore } from './teacherPerformance/shared'

const TABS = [
  { key: 'report', label: 'Report' },
  { key: 'settings', label: 'Settings' },
]

function winsText(t) {
  return t.quickest_wins?.length ? t.quickest_wins.map((w) => w.label).join(', ') : '—'
}

function ExportButtons({ range }) {
  const { showError } = useToast()
  const [busy, setBusy] = useState(null)

  async function download(format) {
    setBusy(format)
    try {
      const res = await teacherPerformanceApi.exportReport({ ...range, format })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `teacher-performance-${range.start}-to-${range.end}.${format === 'XLSX' ? 'xlsx' : 'pdf'}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch {
      showError('Could not export the report. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex gap-2">
      <Button variant="secondary" size="sm" loading={busy === 'PDF'} disabled={!!busy} onClick={() => download('PDF')}>
        Export PDF
      </Button>
      <Button variant="secondary" size="sm" loading={busy === 'XLSX'} disabled={!!busy} onClick={() => download('XLSX')}>
        Export Excel
      </Button>
    </div>
  )
}

function ReportList({ range, onOpen }) {
  const [view, setView] = useViewPreference('teacher-performance')
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['teacher-performance', 'list', range.start, range.end],
    queryFn: () => teacherPerformanceApi.getReport(range).then((r) => r.data),
    enabled: !!range.start && !!range.end && range.start <= range.end,
  })

  if (range.start > range.end) return <ErrorState title="Check the dates" message="The start date is after the end date." compact />
  if (isLoading) return <LoadingState label="Working out scores…" />
  if (isError) return <ErrorState onRetry={refetch} />

  const teachers = data.teachers
  if (!teachers.length) {
    return (
      <EmptyState
        title="No teachers to score"
        description="Only active staff marked as teaching staff, with a login for this school, appear here. Set “Teaching staff” on the staff form."
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          {data.out_of} teacher{data.out_of === 1 ? '' : 's'} ranked ·{' '}
          {data.snapshot
            ? `frozen on ${new Date(data.frozen_at).toLocaleDateString()}`
            : `counted until ${data.period.counted_until}`}
          <PerformanceInfo />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButtons range={range} />
          <ViewToggle view={view} onChange={setView} />
        </div>
      </div>
      {view === 'table' ? (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <table className="min-w-full">
            <thead className={THEAD}>
              <tr>
                <th className={th('right')}>Rank</th>
                <th className={th()}>Teacher</th>
                <th className={th('right')}>Score</th>
                <th className={th()}>Band</th>
                <th className={th()}>Quickest wins</th>
              </tr>
            </thead>
            <tbody className={TBODY}>
              {teachers.map((t) => (
                <tr
                  key={t.staff_id}
                  className={`${TR} cursor-pointer`}
                  onClick={() => onOpen(t.staff_id)}
                  onKeyDown={(e) => e.key === 'Enter' && onOpen(t.staff_id)}
                  tabIndex={0}
                >
                  <td className={td('right', 'tabular-nums')}>{t.rank ?? '—'}</td>
                  <td className={td()}>
                    <span className="font-medium text-primary-700">{t.name}</span>
                    {t.employee_id && <span className="ml-2 text-xs text-gray-400">{t.employee_id}</span>}
                  </td>
                  <td className={td('right', 'font-semibold tabular-nums')}>{formatScore(t.overall_score)}</td>
                  <td className={td()}><StatusPill label={t.band?.label} tone={bandTone(t.band)} /></td>
                  <td className={td('left', 'text-gray-600')}>{winsText(t)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <CardGrid>
          {teachers.map((t) => (
            <RecordCard
              key={t.staff_id}
              leading={<Avatar name={t.name} />}
              title={t.name}
              meta={t.rank ? `Rank ${t.rank} of ${data.out_of}` : 'Not ranked'}
              status={<StatusPill label={t.band?.label} tone={bandTone(t.band)} />}
              fields={[
                { label: 'Score', value: formatScore(t.overall_score), mono: true },
                { label: 'Quickest wins', value: winsText(t) },
              ]}
              actions={[{ label: 'View details', tone: 'info', onClick: () => onOpen(t.staff_id) }]}
            />
          ))}
        </CardGrid>
      )}
    </div>
  )
}

export default function TeacherPerformancePage() {
  const [tab, setTab] = useState('report')
  const period = usePeriod()
  const { range } = period
  const [openStaffId, setOpenStaffId] = useState(null)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teacher Performance"
        subtitle="Work done against work due for each teacher: attendance, lesson plans, marks, homework, messages and more."
      />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex gap-4" aria-label="Teacher performance sections">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-current={tab === t.key ? 'page' : undefined}
              className={`border-b-2 px-1 pb-2 text-sm font-medium ${
                tab === t.key
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        {tab === 'report' && (
          <div className="pb-2">
            <PeriodPicker {...period} />
          </div>
        )}
      </div>

      {tab === 'settings' ? (
        <TeacherPerformanceSettings />
      ) : openStaffId ? (
        <TeacherPerformanceDetail staffId={openStaffId} range={range} onBack={() => setOpenStaffId(null)} />
      ) : (
        <ReportList range={range} onOpen={setOpenStaffId} />
      )}
    </div>
  )
}
