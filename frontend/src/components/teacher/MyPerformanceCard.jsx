import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { teacherPerformanceApi } from '../../services/api'
import { StatusPill } from '../cards'
import PerformanceInfo from './PerformanceInfo'
import { bandTone, currentMonth, formatScore, monthRange, ordinal } from '../../pages/hr/teacherPerformance/shared'

/**
 * "My performance" on the teacher dashboard: this month's score, band, own position (if the school
 * shows it) and quickest wins. Renders nothing when the teacher is not on the report or the school
 * has not turned it on for teachers.
 */
export default function MyPerformanceCard() {
  const range = monthRange(currentMonth())
  const { data, isLoading, isError } = useQuery({
    queryKey: ['teacher-performance', 'mine', undefined, range.start, range.end],
    queryFn: () => teacherPerformanceApi.getMine(range).then((r) => r.data),
    retry: false,
    staleTime: 5 * 60 * 1000,
  })

  if (isError || data?.enabled === false) return null

  const t = data?.teacher
  return (
    <section
      aria-labelledby="my-performance-title"
      className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="my-performance-title" className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-gray-100">
          My performance
          {t && <PerformanceInfo wins={t.quickest_wins} />}
        </h2>
        <Link to="/my-performance" className="text-xs font-medium text-primary-600 hover:underline">Details</Link>
      </div>
      {isLoading || !t ? (
        <div className="mt-3 h-12 animate-pulse rounded bg-gray-100 dark:bg-gray-700" aria-busy="true" />
      ) : (
        <>
          <div className="mt-2 flex items-end gap-3">
            <span className="text-3xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{formatScore(t.overall_score)}</span>
            <div className="pb-1">
              <StatusPill label={t.band?.label} tone={bandTone(t.band)} />
              {t.rank && data.out_of && (
                <p className="mt-0.5 text-xs text-gray-500">{ordinal(t.rank)} of {data.out_of} this month</p>
              )}
            </div>
          </div>
          {t.quickest_wins?.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-gray-500">Quickest wins</p>
              <ul className="mt-1 space-y-0.5 text-sm text-gray-700 dark:text-gray-300">
                {t.quickest_wins.map((w) => (
                  <li key={w.key}>{w.label} <span className="text-xs text-gray-400">(+{w.points_available})</span></li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  )
}
