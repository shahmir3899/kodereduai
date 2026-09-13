import { useMemo } from 'react'

// Renders a term-long axis (academic year start_date..end_date) with each
// topic as a row carrying up to two markers: a hollow diamond for its planned
// date, a filled dot for when it was actually first taught (derived from the
// earliest lesson plan covering it this year). Built for the "where are the
// gaps/delays" question the table view can't answer on its own -- see
// Curriculum Coverage feedback (major UI proposal).

function daysBetween(a, b) {
  return (new Date(b) - new Date(a)) / 86400000
}

function formatShort(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function monthTicks(startDate, endDate) {
  const ticks = []
  const cursor = new Date(startDate)
  cursor.setDate(1)
  const end = new Date(endDate)
  while (cursor <= end) {
    ticks.push(new Date(cursor))
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return ticks
}

export default function CurriculumTimeline({ topics, academicYear }) {
  const startDate = academicYear?.start_date
  const endDate = academicYear?.end_date
  const totalDays = useMemo(
    () => (startDate && endDate ? Math.max(1, daysBetween(startDate, endDate)) : null),
    [startDate, endDate],
  )

  const positionOf = (dateStr) => {
    if (!dateStr || !totalDays) return null
    const offset = daysBetween(startDate, dateStr)
    return Math.min(100, Math.max(0, (offset / totalDays) * 100))
  }

  if (!startDate || !endDate) {
    return (
      <p className="text-sm text-gray-500">
        This academic year has no start/end date set, so a timeline can't be drawn -- showing dates as plain
        text instead. Set the academic year's date range to enable the timeline.
      </p>
    )
  }

  const ticks = monthTicks(startDate, endDate)
  const today = new Date().toISOString().slice(0, 10)
  const todayPos = positionOf(today)

  return (
    <div className="space-y-1">
      {/* Month axis */}
      <div className="relative h-6 ml-40 border-b border-gray-200 text-[10px] text-gray-400">
        {ticks.map((tick) => (
          <span
            key={tick.toISOString()}
            className="absolute -translate-x-1/2"
            style={{ left: `${positionOf(tick.toISOString().slice(0, 10))}%` }}
          >
            {tick.toLocaleDateString(undefined, { month: 'short' })}
          </span>
        ))}
      </div>

      <div className="space-y-2">
        {topics.map((topic) => {
          const plannedPos = positionOf(topic.planned_date)
          const taughtPos = positionOf(topic.taught_date)
          const isLate = topic.planned_date && topic.taught_date && topic.taught_date > topic.planned_date
          const isPlannedButNotTaught = topic.planned_date && !topic.taught_date && topic.planned_date < today

          return (
            <div key={topic.id} className="flex items-center gap-3">
              <div className="w-40 flex-shrink-0 text-xs text-gray-700 truncate" title={topic.title}>
                {topic.topic_number}. {topic.title}
              </div>
              <div className="relative flex-1 h-6 bg-gray-50 rounded">
                {todayPos != null && (
                  <div
                    className="absolute top-0 bottom-0 w-px bg-red-200"
                    style={{ left: `${todayPos}%` }}
                    title="Today"
                  />
                )}
                {plannedPos != null && taughtPos != null && (
                  <div
                    className={`absolute top-1/2 h-0.5 -translate-y-1/2 ${isLate ? 'bg-amber-300' : 'bg-green-300'}`}
                    style={{
                      left: `${Math.min(plannedPos, taughtPos)}%`,
                      width: `${Math.abs(taughtPos - plannedPos)}%`,
                    }}
                  />
                )}
                {plannedPos != null && (
                  <div
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rotate-45 border-2 border-indigo-400 bg-white"
                    style={{ left: `${plannedPos}%` }}
                    title={`Planned: ${formatShort(topic.planned_date)}`}
                  />
                )}
                {taughtPos != null && (
                  <div
                    className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full ${isLate ? 'bg-amber-500' : 'bg-green-500'}`}
                    style={{ left: `${taughtPos}%` }}
                    title={`Taught: ${formatShort(topic.taught_date)}`}
                  />
                )}
                {isPlannedButNotTaught && (
                  <span
                    className="absolute top-1/2 -translate-y-1/2 text-[10px] text-red-500 whitespace-nowrap"
                    style={{ left: `calc(${plannedPos}% + 8px)` }}
                  >
                    overdue
                  </span>
                )}
              </div>
              <div className="w-24 flex-shrink-0 text-[10px] text-gray-400 text-right">
                {topic.planned_date && !topic.taught_date && `plan ${formatShort(topic.planned_date)}`}
                {topic.taught_date && `taught ${formatShort(topic.taught_date)}`}
                {!topic.planned_date && !topic.taught_date && '—'}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-4 pt-2 text-[10px] text-gray-500">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rotate-45 border-2 border-indigo-400 bg-white inline-block" /> Planned</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" /> Taught on/before plan</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> Taught late</span>
        <span className="flex items-center gap-1"><span className="w-px h-3 bg-red-200 inline-block" /> Today</span>
      </div>
    </div>
  )
}
