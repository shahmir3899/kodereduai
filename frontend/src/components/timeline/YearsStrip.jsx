import { useState } from 'react'
import { formatDay } from '../../pages/sessions/termDefaults'
import { TODAY_MARKER } from '../academic/academicTones'
import { dayNumber, findOverlaps, pickYearWindow, positionPercent, spanStyle, todayIso } from './timelineMath'

const VISIBLE_ROWS = 3

/**
 * Academic years on one shared time axis, one row per year, so overlaps and gaps between years
 * are visible at a glance. Only a few rows around the current year show by default; the overlap
 * warning covers every year, hidden or not.
 */
export default function YearsStrip({ years = [] }) {
  const [showAll, setShowAll] = useState(false)
  const dated = years.filter(y => y.start_date && y.end_date)
  if (dated.length < 2) return null

  const sorted = [...dated].sort((a, b) => a.start_date.localeCompare(b.start_date))
  const clashing = findOverlaps(sorted)
  const clashNames = sorted.filter(y => clashing.has(y.id)).map(y => y.name)
  const rows = showAll ? sorted : pickYearWindow(sorted, VISIBLE_ROWS)
  const hidden = sorted.length - rows.length

  // The axis spans only the rows shown, so old years do not squeeze the current one into a sliver.
  const from = rows.reduce((min, y) => (y.start_date < min ? y.start_date : min), rows[0].start_date)
  const to = rows.reduce((max, y) => (y.end_date > max ? y.end_date : max), rows[0].end_date)
  const today = todayIso()
  const showToday = dayNumber(today) >= dayNumber(from) && dayNumber(today) <= dayNumber(to)

  return (
    <div className="card mb-4 p-3 sm:p-4 dark:bg-gray-800 dark:border-gray-700">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Academic years</h3>
        {sorted.length > VISIBLE_ROWS && (
          <button type="button" onClick={() => setShowAll(v => !v)} className="text-xs text-primary-600 hover:underline dark:text-primary-400">
            {showAll ? 'Show fewer' : `Show all (${sorted.length})`}
          </button>
        )}
      </div>
      {clashNames.length > 0 && (
        <p className="mb-2 text-xs font-medium text-red-600 dark:text-red-400">
          Dates overlap: {clashNames.join(', ')}
        </p>
      )}
      <div className="relative space-y-1">
        {rows.map(y => {
          const style = spanStyle(y.start_date, y.end_date, from, to)
          const clash = clashing.has(y.id)
          return (
            <div key={y.id} className="relative h-6 rounded bg-gray-100 dark:bg-gray-700">
              <div
                title={`${y.name}: ${formatDay(y.start_date)} - ${formatDay(y.end_date)}`}
                className={`absolute inset-y-0 flex items-center overflow-hidden rounded px-1.5 text-[11px] font-medium text-white ${y.is_current ? 'bg-green-600' : 'bg-gray-500 dark:bg-gray-400 dark:text-gray-900'} ${clash ? 'ring-2 ring-red-500 ring-inset' : ''}`}
                style={{ left: `${style.left}%`, width: `${style.width}%` }}
              >
                <span className="truncate">{y.name}</span>
              </div>
            </div>
          )
        })}
        {showToday && (
          <div
            title={`Today: ${formatDay(today)}`}
            className={`pointer-events-none absolute inset-y-0 w-0.5 ${TODAY_MARKER}`}
            style={{ left: `${positionPercent(today, from, to)}%` }}
          />
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-gray-500 dark:text-gray-400">
        <span>{formatDay(from)}</span>
        {hidden > 0 && <span>{hidden} more year{hidden === 1 ? '' : 's'} hidden</span>}
        <span>{formatDay(to)}</span>
      </div>
    </div>
  )
}
