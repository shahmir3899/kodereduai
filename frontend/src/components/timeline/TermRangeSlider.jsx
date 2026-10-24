import { addDays, formatDay } from '../../pages/sessions/termDefaults'
import { dayNumber, spanStyle } from './timelineMath'

/**
 * Drag the two handles to pick a term's start and end inside its academic year. Values snap to whole
 * days and the handles can never cross. The typed date fields stay next to it, so the slider is a
 * shortcut and never the only way to enter a date.
 *
 * `start`/`end` are ISO dates; `onChange({ start_date, end_date })` fires on every move.
 */
export default function TermRangeSlider({ min, max, start, end, onChange, invalid = false }) {
  const total = dayNumber(max) - dayNumber(min)
  if (!(total > 0) || !start || !end) return null

  const s = Math.min(Math.max(dayNumber(start) - dayNumber(min), 0), total)
  const e = Math.min(Math.max(dayNumber(end) - dayNumber(min), 0), total)
  const fill = spanStyle(start, end, min, max)
  const emit = (a, b) => onChange({ start_date: addDays(min, a), end_date: addDays(min, b) })

  return (
    <div className={invalid ? 'text-red-600' : 'text-primary-600'}>
      <div className="range-dual relative h-9 rounded-md bg-gray-100 dark:bg-gray-700">
        {fill && (
          <div
            className={`absolute inset-y-1 rounded ${invalid ? 'bg-red-500/30' : 'bg-primary-500/30'}`}
            style={{ left: `${fill.left}%`, width: `${fill.width}%` }}
          />
        )}
        <input
          type="range" min={0} max={total} step={1} value={s}
          aria-label="Term start"
          aria-valuetext={formatDay(start)}
          onChange={ev => emit(Math.min(Number(ev.target.value), e - 1), e)}
        />
        <input
          type="range" min={0} max={total} step={1} value={e}
          aria-label="Term end"
          aria-valuetext={formatDay(end)}
          onChange={ev => emit(s, Math.max(Number(ev.target.value), s + 1))}
        />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-gray-600 dark:text-gray-300">
        <span>{formatDay(start)}</span>
        <span>{dayNumber(end) - dayNumber(start) + 1} days</span>
        <span>{formatDay(end)}</span>
      </div>
    </div>
  )
}
