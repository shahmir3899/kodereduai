import Badge from '../../../components/ui/Badge'
import { ENTRY_TONE, ENTRY_DOT, TERM_COLOURS, DEFAULT_EVENT_COLOR, DEFAULT_OFF_COLOR } from '../../../components/academic/academicTones'
import { formatDay } from '../../sessions/termDefaults'
import { DAY_LABELS, isoDate } from './calendarUtils'

/**
 * The month as a 7-column grid. From the sm breakpoint up each day shows named pills; on phones the
 * cells shrink and show coloured dots instead (tap a day for its details, or switch to Agenda).
 * A thin strip across the top of a day carries the colour of the term it falls in.
 */
export default function MonthGrid({
  year, month, daysInMonth, startOffset,
  monthDaysByDate, examGroupsByDate, termAt, todayKey, coverageByDate = {},
  isRangeSelecting, rangeAnchorDate, previewStart, previewEnd,
  onPointerDown, onPointerEnter, onPointerUp, onActivate,
}) {
  const cells = []

  for (let i = 0; i < startOffset; i += 1) {
    cells.push(<div key={`blank-${i}`} className="rounded-xl border border-gray-100 bg-gray-50 min-h-[64px] sm:min-h-[120px] dark:border-gray-700 dark:bg-gray-800/50" />)
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = isoDate(year, month, day)
    const dayInfo = monthDaysByDate[dateKey]
    const isOff = !!dayInfo?.is_off_day
    const events = dayInfo?.events || []
    const eventsCount = events.length
    const offDayEntries = (dayInfo?.entries || []).filter((entry) => entry.entry_kind === 'OFF_DAY')
    const offDayTitles = [...new Set(offDayEntries.map((entry) => entry.name).filter(Boolean))]
    const hasSundayOnlyOff = isOff && offDayTitles.length === 0 && (dayInfo?.is_sunday || false)
    // OFF day audience decides which badge the day shows.
    const allOffStaff = offDayEntries.every((e) => e.affects_staff !== false)
    const anyOffStudents = offDayEntries.some((e) => e.affects_students !== false)
    const isStudentsOnlyOff = isOff && !hasSundayOnlyOff && anyOffStudents && !allOffStaff
    const examNames = examGroupsByDate[dateKey] || []
    const isAnchor = isRangeSelecting && rangeAnchorDate === dateKey
    const isWithinPendingRange = !!previewStart && dateKey >= previewStart && dateKey <= previewEnd
    const isToday = dateKey === todayKey
    const term = termAt(dateKey)
    const cover = coverageByDate[dateKey]
    const attendanceGap = cover && (cover.state === 'missed' || cover.state === 'partial')

    cells.push(
      <div
        key={dateKey}
        className={`relative overflow-hidden rounded-xl border min-h-[64px] sm:min-h-[120px] p-1.5 sm:p-3 cursor-pointer hover:border-primary-300 transition select-none ${isOff ? 'border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-900/20' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'} ${isWithinPendingRange ? 'ring-2 ring-primary-200' : ''} ${isAnchor ? 'ring-2 ring-primary-500' : ''}`}
        onPointerDown={(e) => onPointerDown(e, dateKey)}
        onPointerEnter={(e) => onPointerEnter(e, dateKey)}
        onPointerUp={(e) => onPointerUp(e, dateKey)}
        role="button"
        tabIndex={0}
        aria-label={`${formatDay(dateKey)}${isOff ? ', off day' : ''}${isToday ? ', today' : ''}${term ? `, ${term.term.name}` : ''}`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onActivate(dateKey)
          }
        }}
      >
        {term && (
          <div
            title={term.term.name}
            className={`absolute inset-x-0 top-0 h-1 ${TERM_COLOURS[term.index % TERM_COLOURS.length]}`}
          />
        )}

        <div className="flex items-center justify-between mt-0.5">
          <p className={isToday
            ? 'inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-primary-600 px-1 text-xs sm:text-sm font-semibold text-white'
            : 'text-xs sm:text-sm font-semibold text-gray-900 dark:text-gray-100'}
          >{day}</p>
          <span className="hidden sm:inline-flex">
            {isOff && !isStudentsOnlyOff && <Badge colors={ENTRY_TONE.off} className="!px-2 !py-0.5 !text-[10px]">OFF</Badge>}
            {isStudentsOnlyOff && <Badge colors={ENTRY_TONE.offStudents} className="!px-2 !py-0.5 !text-[10px]">OFF (Students)</Badge>}
          </span>
        </div>

        {attendanceGap && (
          <span
            title={cover.state === 'missed' ? 'Attendance not recorded' : `Attendance recorded for ${cover.classes_marked} of ${cover.classes_expected} classes`}
            className={`absolute bottom-1 right-1 h-2 w-2 rounded-full ${cover.state === 'missed' ? 'bg-amber-400' : 'bg-amber-200 ring-1 ring-amber-400'}`}
          />
        )}

        {/* Phones: dots only. */}
        <div className="mt-1 flex flex-wrap gap-1 sm:hidden">
          {isOff && <span className={`h-2 w-2 rounded-full ${isStudentsOnlyOff ? ENTRY_DOT.offStudents : ENTRY_DOT.off}`} />}
          {events.slice(0, 3).map((ev, i) => (
            <span key={ev.id ?? i} className="h-2 w-2 rounded-full" style={{ backgroundColor: ev.color || DEFAULT_EVENT_COLOR }} />
          ))}
          {examNames.length > 0 && <span className={`h-2 w-2 rounded-full ${ENTRY_DOT.exam}`} />}
        </div>

        {/* sm and up: named pills. */}
        <div className="hidden sm:block">
          {(offDayTitles.length > 0 || hasSundayOnlyOff) && (
            <div className="mt-2">
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded block truncate text-white"
                style={{ backgroundColor: offDayEntries[0]?.color || DEFAULT_OFF_COLOR }}
              >{offDayTitles[0] || 'Sunday'}</span>
              {offDayTitles.length > 1 && (
                <p className="mt-0.5 text-[10px]" style={{ color: offDayEntries[0]?.color || DEFAULT_OFF_COLOR }}>+{offDayTitles.length - 1} more</p>
              )}
            </div>
          )}
          {eventsCount > 0 && (
            <div className="mt-2">
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded block truncate text-white"
                style={{ backgroundColor: events[0]?.color || DEFAULT_EVENT_COLOR }}
                title={events[0]?.name || ''}
              >
                {events[0]?.name || 'Event'}
              </span>
              {eventsCount > 1 && (
                <p className="mt-1 text-[10px]" style={{ color: events[0]?.color || DEFAULT_EVENT_COLOR }}>+{eventsCount - 1} more</p>
              )}
            </div>
          )}
          {examNames.map((name) => (
            <span key={name} className={`mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded block truncate ${ENTRY_TONE.exam}`} title={name}>
              {name}
            </span>
          ))}
        </div>
      </div>,
    )
  }

  return (
    <>
      <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-2">
        {DAY_LABELS.map((dayLabel) => (
          <div key={dayLabel} className="text-center text-xs font-semibold text-gray-500 py-2 dark:text-gray-400">{dayLabel}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 sm:gap-2">{cells}</div>
    </>
  )
}
