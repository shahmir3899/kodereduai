import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { sessionsApi, examinationsApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { schoolNowDate } from '../../utils/schoolTime'
import { ENTRY_DOT, DEFAULT_EVENT_COLOR, DEFAULT_OFF_COLOR } from '../academic/academicTones'
import { DAY_LABELS, MONTH_NAMES, getMonthMeta, isoDate } from '../../pages/academics/calendar/calendarUtils'

// Matches ENTRY_DOT.exam (bg-indigo-400) for the popover rows, which need an inline colour.
const EXAM_COLOR = '#818cf8'

/**
 * Read-only month view for the Admin / Principal dashboards. Whole-school calendar only (no class
 * filter), and nothing here edits: tapping a day does nothing, "Full calendar" is the place to manage.
 */
export default function AcademicCalendarWidget() {
  const { isModuleEnabled } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const today = schoolNowDate()
  const todayKey = isoDate(today.getFullYear(), today.getMonth() + 1, today.getDate())
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)

  const yearId = activeAcademicYear?.id
  const enabled = !!yearId && isModuleEnabled('academics')

  const { daysInMonth, startOffset } = useMemo(() => getMonthMeta(year, month), [year, month])
  const monthStart = isoDate(year, month, 1)
  const monthEnd = isoDate(year, month, daysInMonth)

  const { data: monthRes } = useQuery({
    queryKey: ['calendarMonthView', yearId, year, month, ''],
    queryFn: () => sessionsApi.getCalendarMonthView({ academic_year: yearId, year, month }),
    enabled,
  })

  // Same key as the calendar page so the two share one cached list.
  const { data: examRes } = useQuery({
    queryKey: ['calendarExamGroups', yearId],
    queryFn: () => examinationsApi.getExamGroups({ academic_year: yearId, page_size: 100, is_active: true }),
    enabled: enabled && isModuleEnabled('examinations'),
  })

  const daysByDate = useMemo(() => {
    const map = {}
    ;(monthRes?.data?.days || []).forEach((d) => { map[d.date] = d })
    return map
  }, [monthRes])

  const examGroups = useMemo(() => {
    const list = examRes?.data?.results || examRes?.data || []
    return list.filter((g) => g.start_date && g.end_date && g.end_date >= monthStart && g.start_date <= monthEnd)
  }, [examRes, monthStart, monthEnd])

  const examOn = (dateKey) => examGroups.some((g) => g.start_date <= dateKey && dateKey <= g.end_date)

  if (!enabled) return null

  const step = (delta) => {
    const index = year * 12 + (month - 1) + delta
    setYear(Math.floor(index / 12))
    setMonth((index % 12) + 1)
  }
  const goToday = () => {
    setYear(today.getFullYear())
    setMonth(today.getMonth() + 1)
  }

  const cells = []
  for (let i = 0; i < startOffset; i += 1) cells.push(<div key={`b${i}`} />)
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = isoDate(year, month, day)
    const info = daysByDate[key]
    const isOff = !!info?.is_off_day
    const events = info?.events || []
    const isToday = key === todayKey
    // Every entry on this date, one row each; shown on hover/focus so nothing is hidden by the 3-dot cap.
    const rows = (info?.entries || []).map((e) => ({
      id: `e${e.id ?? e.name}`,
      name: e.name,
      color: e.color || (e.entry_kind === 'OFF_DAY' ? DEFAULT_OFF_COLOR : DEFAULT_EVENT_COLOR),
    }))
    if (isOff && rows.length === 0) rows.push({ id: 'off', name: info?.is_sunday ? 'Sunday' : 'Off day', color: DEFAULT_OFF_COLOR })
    examGroups.filter((g) => g.start_date <= key && key <= g.end_date)
      .forEach((g) => rows.push({ id: `x${g.id ?? g.name}`, name: g.name, color: EXAM_COLOR }))
    // Edge columns anchor the popover inward so it is not clipped by the card.
    const col = (startOffset + day - 1) % 7
    const popAlign = col <= 1 ? 'left-0' : col >= 5 ? 'right-0' : 'left-1/2 -translate-x-1/2'
    cells.push(
      <div
        key={key}
        data-testid={`cal-day-${key}`}
        tabIndex={rows.length ? 0 : undefined}
        className={`group relative flex min-h-[42px] flex-col items-center rounded-md border p-0.5 outline-none focus:ring-2 focus:ring-primary-300 sm:min-h-[56px] sm:rounded-lg sm:p-1 ${isOff ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-white'}`}
      >
        <span className={isToday
          ? 'inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary-600 px-1 text-xs font-semibold text-white'
          : 'text-xs font-medium text-gray-800'}
        >{day}</span>
        <div className="mt-1 flex flex-wrap justify-center gap-0.5">
          {isOff && <span className={`h-1.5 w-1.5 rounded-full ${ENTRY_DOT.off}`} />}
          {events.slice(0, 3).map((ev, i) => (
            <span key={ev.id ?? i} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ev.color || DEFAULT_EVENT_COLOR }} />
          ))}
          {examOn(key) && <span className={`h-1.5 w-1.5 rounded-full ${ENTRY_DOT.exam}`} />}
        </div>
        {rows.length > 0 && (
          <div
            role="tooltip"
            data-testid={`cal-pop-${key}`}
            className={`pointer-events-none invisible absolute top-full z-30 mt-1 w-44 max-w-[70vw] space-y-1 sm:w-52 rounded-lg border border-gray-200 bg-white p-2 text-left shadow-lg group-hover:visible group-focus:visible ${popAlign}`}
          >
            <p className="text-[11px] font-semibold text-gray-500">{rangeLabel(key)}</p>
            {rows.map((r) => (
              <div key={r.id} className="flex items-start gap-2 text-xs text-gray-800">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
                <span className="min-w-0 break-words">{r.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>,
    )
  }

  return (
    <div className="card !p-3 sm:!p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Academic Calendar</h2>
        <Link to="/academics/calendar" className="text-xs font-medium text-sky-600 hover:text-sky-700">Full calendar</Link>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={() => step(-1)} aria-label="Previous month" className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-lg text-gray-700 hover:bg-gray-50 sm:h-8 sm:w-8 sm:text-base">‹</button>
        <div className="text-center">
          <p className="text-sm font-semibold text-gray-900">{MONTH_NAMES[month - 1]} {year}</p>
          <button type="button" onClick={goToday} className="text-[11px] font-medium text-sky-600 hover:text-sky-700">Today</button>
        </div>
        <button type="button" onClick={() => step(1)} aria-label="Next month" className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 text-lg text-gray-700 hover:bg-gray-50 sm:h-8 sm:w-8 sm:text-base">›</button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-0.5 sm:gap-1">
        {DAY_LABELS.map((d) => <div key={d} className="py-1 text-center text-[10px] font-semibold text-gray-500 sm:text-[11px]">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5 sm:gap-1">{cells}</div>
      <p className="mt-2 text-center text-[11px] text-gray-400 sm:hidden">Tap a date to see its entries</p>
    </div>
  )
}

function rangeLabel(key) {
  const [, m, d] = key.split('-').map(Number)
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)}`
}
