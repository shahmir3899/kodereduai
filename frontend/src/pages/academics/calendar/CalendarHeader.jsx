import { Link } from 'react-router-dom'
import Badge from '../../../components/ui/Badge'
import Button from '../../../components/ui/Button'
import { TERM_COLOURS, yearBadges } from '../../../components/academic/academicTones'
import PlanningChip from './PlanningChip'
import { MONTH_NAMES, classLabel, monthOptions } from './calendarUtils'

const VIEWS = [
  { value: 'month', label: 'Month' },
  { value: 'agenda', label: 'Agenda' },
]

/**
 * Month navigation (previous / next / Today / jump within the academic year), the academic-year
 * chip that links to the Years page, the class filter, the month's terms and the view switch.
 */
export default function CalendarHeader({
  academicYear, year, month, onPrev, onNext, onToday, onJump,
  view, onViewChange,
  classes, selectedClassId, onClassChange,
  termsThisMonth, coverage, planning, isSchoolAdmin, onAddEntry,
}) {
  const options = monthOptions(academicYear, year, month)
  const outside = options.find((o) => o.year === year && o.month === month)?.outside
  const badges = academicYear ? yearBadges(academicYear, academicYear.id).filter((b) => b.key !== 'viewing') : []

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="icon" onClick={onPrev} aria-label="Previous month">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </Button>
        <select
          aria-label="Jump to month"
          value={`${year}-${month}`}
          onChange={(e) => {
            const [y, m] = e.target.value.split('-').map(Number)
            onJump(y, m)
          }}
          className="input !w-auto !py-1.5 font-semibold"
        >
          {options.map((o) => (
            <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>
              {MONTH_NAMES[o.month - 1]} {o.year}{o.outside ? ' (outside this year)' : ''}
            </option>
          ))}
        </select>
        <Button variant="secondary" size="icon" onClick={onNext} aria-label="Next month">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </Button>
        <Button variant="ghost" size="sm" onClick={onToday}>Today</Button>
        {outside && <Badge tone="warning">Outside the academic year</Badge>}

        <div className="ml-auto inline-flex items-center rounded-lg bg-gray-100 p-0.5 dark:bg-gray-700" role="group" aria-label="Calendar view">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              aria-pressed={view === v.value}
              onClick={() => onViewChange(v.value)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${view === v.value ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-gray-100' : 'text-gray-500 hover:text-gray-700 dark:text-gray-300'}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/academics/sessions"
          title="Manage academic years and terms"
          className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          <svg className="h-3.5 w-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          {academicYear?.name}
        </Link>
        {badges.map((b) => <Badge key={b.key} tone={b.tone}>{b.label}</Badge>)}

        <select
          aria-label="Class filter"
          value={selectedClassId}
          onChange={(e) => onClassChange(e.target.value)}
          className="input !w-auto !py-1 text-xs"
        >
          <option value="">Whole School</option>
          {classes.map((cls) => (
            <option key={cls.id} value={cls.id}>{classLabel(cls)}</option>
          ))}
        </select>

        {termsThisMonth.map(({ term, index }) => (
          <span key={term.id} className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300" title={`${term.name}`}>
            <span className={`h-2.5 w-2.5 rounded-sm ${TERM_COLOURS[index % TERM_COLOURS.length]}`} />
            {term.name}
          </span>
        ))}

        <div className="ml-auto flex flex-wrap items-center gap-2">
        {coverage?.summary?.percent != null && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-medium text-green-700 dark:border-green-900/60 dark:bg-green-900/20 dark:text-green-300"
            title={`${coverage.summary.marked} of ${coverage.summary.expected} class-days had attendance recorded this month${coverage.summary.missed_days ? `; ${coverage.summary.missed_days} day(s) with none` : ''}`}
          >
            Attendance recorded {coverage.summary.percent}%
            {coverage.summary.missed_days > 0 && <span className="text-amber-600 dark:text-amber-300">· {coverage.summary.missed_days} missed</span>}
          </span>
        )}
        {coverage?.streak?.pace_window > 0 && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
            title={`Streak counts working days when every class marked attendance on the day itself. On time for ${coverage.streak.pace_on_time} of the last ${coverage.streak.pace_window} working days.`}
          >
            Streak {coverage.streak.current} day{coverage.streak.current === 1 ? '' : 's'} · {coverage.streak.pace_on_time}/{coverage.streak.pace_window} on time
          </span>
        )}
          <PlanningChip planning={planning} isSchoolAdmin={isSchoolAdmin} onAddEntry={onAddEntry} />
        </div>
      </div>
    </div>
  )
}
