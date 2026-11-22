import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { teacherPerformanceApi } from '../../../services/api'
import { StatusPill } from '../../../components/cards'
import Button from '../../../components/ui/Button'
import LoadingState from '../../../components/ui/LoadingState'
import ErrorState from '../../../components/ui/ErrorState'
import PerformanceInfo from '../../../components/teacher/PerformanceInfo'
import { appraisalPrefill, bandTone, describeMissed, formatScore, infoRows, ordinal, orderedMeasures } from './shared'

function Bar({ value, tone }) {
  const colour = { good: 'bg-green-500', mid: 'bg-amber-500', low: 'bg-red-500' }[tone]
  return (
    <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-700" aria-hidden="true">
      <div className={`h-2 rounded-full ${colour}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

function MeasureRow({ m }) {
  if (!m.applicable) {
    return (
      <li className="rounded-lg border border-dashed border-gray-200 p-3 text-sm text-gray-400 dark:border-gray-700">
        <span className="font-medium">{m.label}</span> — does not apply in this period
      </li>
    )
  }
  const tone = m.score >= 75 ? 'good' : m.score >= 60 ? 'mid' : 'low'
  return (
    <li className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-gray-100">
          {m.label}
          <PerformanceInfo measure={m.key} label={`How ${m.label} is scored`} />
        </span>
        <span className="text-sm font-semibold tabular-nums">{formatScore(m.score)}</span>
      </div>
      <div className="mt-2"><Bar value={m.score} tone={tone} /></div>
      <p className="mt-1.5 text-xs text-gray-500 tabular-nums">
        Due {m.due} · Done {m.done} · On time {m.on_time} · Weight {m.effective_weight}%
      </p>
      {m.missed?.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-primary-600 hover:underline">
            {m.missed.length >= 30 ? '30+' : m.missed.length} item{m.missed.length === 1 ? '' : 's'} to fix
          </summary>
          <ul className="mt-1 space-y-0.5 text-gray-600 dark:text-gray-300">
            {m.missed.map((item, i) => <li key={i}>{describeMissed(item)}</li>)}
          </ul>
        </details>
      )}
    </li>
  )
}

/**
 * One teacher's breakdown. Admin page: pass staffId. Teacher's own page: pass mine (reads my/).
 */
function InfoPanel({ info }) {
  const rows = infoRows(info)
  if (!rows.length) return null
  return (
    <section className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/60">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">For information, not scored</h3>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-3">
            <dt className="text-gray-500">{r.label}</dt>
            <dd className="font-medium tabular-nums text-gray-900 dark:text-gray-100">{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export default function TeacherPerformanceDetail({ staffId, mine = false, range, onBack }) {
  const navigate = useNavigate()
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['teacher-performance', mine ? 'mine' : 'detail', staffId, range.start, range.end],
    queryFn: () =>
      (mine ? teacherPerformanceApi.getMine(range) : teacherPerformanceApi.getTeacher(staffId, range)).then((r) => r.data),
    retry: (count, err) => err?.response?.status !== 404 && count < 2,
  })

  if (isLoading) return <LoadingState label="Working out the score…" />
  if (isError && error?.response?.status === 404) {
    return <ErrorState title="No report" message="You are not on the teacher performance report for this school." compact />
  }
  if (isError) return <ErrorState onRetry={refetch} />
  if (data.enabled === false) {
    return <ErrorState title="Not available" message="Your school has not turned on the performance report for teachers." compact />
  }

  const t = data.teacher
  return (
    <div className="space-y-4">
      {onBack && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="secondary" size="sm" onClick={onBack}>← All teachers</Button>
          {t.overall_score !== null && (
            <Button
              size="sm"
              onClick={() => navigate('/hr/appraisals', { state: { appraisalPrefill: appraisalPrefill(t, data.period) } })}
            >
              Start appraisal from this report
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t.name}</h2>
          <p className="text-sm text-gray-500">
            {data.period.start} to {data.period.end}
            {data.period.counted_until !== data.period.end && ` (counted until ${data.period.counted_until})`}
          </p>
          {data.snapshot && (
            <p className="mt-1 text-xs text-gray-500">
              Frozen on {new Date(data.frozen_at).toLocaleDateString()}: figures as they stood when the month closed.
            </p>
          )}
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-1.5">
            <span className="text-3xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{formatScore(t.overall_score)}</span>
            <PerformanceInfo wins={t.quickest_wins} />
          </div>
          <div className="mt-1 flex items-center justify-end gap-2">
            <StatusPill label={t.band?.label} tone={bandTone(t.band)} />
            {t.rank && data.out_of && <span className="text-sm text-gray-500">{ordinal(t.rank)} of {data.out_of}</span>}
          </div>
        </div>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {orderedMeasures(t.measures).map((m) => <MeasureRow key={m.key} m={m} />)}
      </ul>
      <InfoPanel info={t.info} />
    </div>
  )
}
