import Badge from '../../../components/ui/Badge'
import EmptyState from '../../../components/ui/EmptyState'
import { ENTRY_TONE, DEFAULT_EVENT_COLOR, DEFAULT_OFF_COLOR } from '../../../components/academic/academicTones'
import { formatDay } from '../../sessions/termDefaults'
import { weekdayLabel } from './calendarUtils'

/**
 * The month as a list of the days that have something on them, in date order. The default on
 * phones, where a seven-column grid is too tight to read entry names.
 */
export default function AgendaView({ monthDays, examGroupsByDate, todayKey, onSelectDate }) {
  const days = monthDays
    .filter((d) => (d.entries || []).length > 0 || (examGroupsByDate[d.date] || []).length > 0)
    .sort((a, b) => a.date.localeCompare(b.date))

  if (days.length === 0) {
    return <EmptyState compact title="Nothing scheduled this month" description="Events, off days and exam periods will be listed here." />
  }

  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
      {days.map((d) => {
        const examNames = examGroupsByDate[d.date] || []
        const isToday = d.date === todayKey
        return (
          <li key={d.date}>
            <button
              type="button"
              onClick={() => onSelectDate(d.date)}
              className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50"
            >
              <div className="w-12 shrink-0 text-center">
                <p className="text-[11px] font-medium uppercase text-gray-500 dark:text-gray-400">{weekdayLabel(d.date)}</p>
                <p className={isToday
                  ? 'mx-auto mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary-600 text-sm font-semibold text-white'
                  : 'text-lg font-semibold text-gray-900 dark:text-gray-100'}
                >{Number(d.date.slice(8))}</p>
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                {(d.entries || []).map((entry) => {
                  const off = entry.entry_kind === 'OFF_DAY'
                  const studentsOnly = off && entry.affects_staff === false
                  return (
                    <div key={entry.id} className="flex items-center gap-2">
                      <span
                        className="h-8 w-1 shrink-0 rounded"
                        style={{ backgroundColor: entry.color || (off ? DEFAULT_OFF_COLOR : DEFAULT_EVENT_COLOR) }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{entry.name}</p>
                        <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                          {entry.start_date !== entry.end_date ? `${formatDay(entry.start_date)} - ${formatDay(entry.end_date)} · ` : ''}
                          {entry.scope === 'CLASS' ? 'Specific classes' : 'Whole school'}
                        </p>
                      </div>
                      {off
                        ? <Badge colors={studentsOnly ? ENTRY_TONE.offStudents : ENTRY_TONE.off}>{studentsOnly ? 'OFF (Students)' : 'OFF'}</Badge>
                        : <Badge colors={ENTRY_TONE.event}>Event</Badge>}
                    </div>
                  )
                })}
                {examNames.map((name) => (
                  <div key={name} className="flex items-center gap-2">
                    <span className="h-8 w-1 shrink-0 rounded bg-indigo-400" />
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-gray-100">{name}</p>
                    <Badge colors={ENTRY_TONE.exam}>Exam</Badge>
                  </div>
                ))}
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
