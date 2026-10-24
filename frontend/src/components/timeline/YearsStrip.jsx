import { formatDay } from '../../pages/sessions/termDefaults'
import { dayNumber, findOverlaps, positionPercent, spanStyle, todayIso } from './timelineMath'

/**
 * Every academic year on one shared time axis, one row per year, so overlaps and gaps between
 * years are visible at a glance. Overlapping years get a red outline.
 */
export default function YearsStrip({ years = [] }) {
  const dated = years.filter(y => y.start_date && y.end_date)
  if (dated.length < 2) return null

  const from = dated.reduce((min, y) => (y.start_date < min ? y.start_date : min), dated[0].start_date)
  const to = dated.reduce((max, y) => (y.end_date > max ? y.end_date : max), dated[0].end_date)
  const overlapping = findOverlaps(dated)
  const rows = [...dated].sort((a, b) => a.start_date.localeCompare(b.start_date))
  const today = todayIso()
  const showToday = dayNumber(today) >= dayNumber(from) && dayNumber(today) <= dayNumber(to)

  return (
    <div className="card mb-4 p-3 sm:p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">All academic years</h3>
        {overlapping.size > 0 && <span className="text-xs font-medium text-red-600 dark:text-red-400">Some years overlap</span>}
      </div>
      <div className="relative space-y-1">
        {rows.map(y => {
          const style = spanStyle(y.start_date, y.end_date, from, to)
          const clash = overlapping.has(y.id)
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
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-red-600"
            style={{ left: `${positionPercent(today, from, to)}%` }}
          />
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-gray-500 dark:text-gray-400">
        <span>{formatDay(from)}</span>
        <span>{formatDay(to)}</span>
      </div>
    </div>
  )
}
