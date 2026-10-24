import { useRef } from 'react'
import { addDays, formatDay } from '../../pages/sessions/termDefaults'
import { dayNumber, findGaps, findOverlaps, positionPercent, spanStyle, todayIso } from './timelineMath'

// Written out in full so Tailwind's scanner sees every class.
const TERM_COLOURS = ['bg-primary-500', 'bg-teal-500', 'bg-amber-500', 'bg-purple-500', 'bg-pink-500', 'bg-sky-500']

// Diagonal hatching marks uncovered days without needing another colour.
const HATCH = {
  backgroundImage: 'repeating-linear-gradient(45deg, rgba(148,163,184,0.55) 0 3px, transparent 3px 7px)',
}

/**
 * One academic year as a bar with its terms drawn inside it: hatched stretches are days no term
 * covers, red-ringed terms overlap another term, and a line marks today.
 *
 * Read-only by default. With `onTermClick` the terms are clickable; with `selectedId` and
 * `onRangeChange` the selected term also gets a drag handle on each edge, so the bar itself is the
 * slider. Handles snap to whole days, never cross, and work with the arrow keys (Shift = a week).
 */
export default function YearTimeline({ year, terms = [], onTermClick, selectedId = null, onRangeChange, compact = false }) {
  const barRef = useRef(null)
  const grabRef = useRef(0) // px between the pointer and the edge it grabbed, so the edge follows the finger instead of jumping to it
  if (!year?.start_date || !year?.end_date) return null
  const { start_date: from, end_date: to } = year

  const overlapping = findOverlaps(terms)
  const gaps = findGaps(terms, from, to)
  const totalDays = dayNumber(to) - dayNumber(from) + 1
  const selected = onRangeChange ? terms.find(t => t.id === selectedId) : null
  const gapDays = gaps.reduce((sum, g) => sum + g.days, 0)
  const today = todayIso()
  const showToday = dayNumber(today) >= dayNumber(from) && dayNumber(today) <= dayNumber(to)

  const sorted = [...terms].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const summary = [
    `${year.name}: ${formatDay(from)} to ${formatDay(to)}`,
    `${terms.length} term${terms.length === 1 ? '' : 's'}`,
    overlapping.size ? 'terms overlap' : null,
    gapDays ? `${gapDays} days not covered by a term` : null,
  ].filter(Boolean).join(', ')

  return (
    <div>
      <div
        ref={barRef}
        role={selected ? 'group' : 'img'}
        aria-label={summary}
        className={`relative w-full overflow-hidden rounded-md bg-gray-100 dark:bg-gray-700 ${compact ? 'h-6' : onRangeChange ? 'h-12 sm:h-9' : 'h-9'}`}
      >
        {gaps.map(g => {
          const style = spanStyle(g.start_date, g.end_date, from, to)
          return style && (
            <div
              key={`gap-${g.start_date}`}
              title={`No term: ${formatDay(g.start_date)} - ${formatDay(g.end_date)} (${g.days} days)`}
              className="absolute inset-y-0"
              style={{ left: `${style.left}%`, width: `${style.width}%`, ...HATCH }}
            />
          )
        })}

        {sorted.map((term, i) => {
          const style = spanStyle(term.start_date, term.end_date, from, to)
          if (!style) return null
          const clash = overlapping.has(term.id)
          const Tag = onTermClick ? 'button' : 'div'
          return (
            <Tag
              key={term.id}
              type={onTermClick ? 'button' : undefined}
              onClick={onTermClick ? () => onTermClick(term) : undefined}
              title={`${term.name}: ${formatDay(term.start_date)} - ${formatDay(term.end_date)}`}
              className={`absolute inset-y-0.5 flex items-center overflow-hidden rounded ${onRangeChange && term.id === selectedId ? 'px-4' : 'px-1.5'} text-left text-[11px] font-medium leading-none text-white ${TERM_COLOURS[i % TERM_COLOURS.length]} ${clash ? 'ring-2 ring-red-500 ring-inset' : term.id === selectedId ? 'ring-2 ring-gray-900 ring-inset dark:ring-white' : ''} ${onTermClick ? 'cursor-pointer hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white' : ''}`}
              style={{ left: `${style.left}%`, width: `${style.width}%` }}
            >
              <span className="truncate">{term.name}</span>
            </Tag>
          )
        })}

        {selected && ['start', 'end'].map(edge => {
          const style = spanStyle(selected.start_date, selected.end_date, from, to)
          const value = edge === 'start' ? selected.start_date : selected.end_date
          // The edge sits on a day boundary: a start edge is the first day's left side, an end edge the last
          // day's right side. Snap the edge (not the raw pointer) to the nearest boundary and keep it in the year.
          const edgePx = () => {
            const rect = barRef.current.getBoundingClientRect()
            const pct = edge === 'start' ? style.left : style.left + style.width
            return rect.left + (rect.width * pct) / 100
          }
          const dayAt = (clientX) => {
            const rect = barRef.current.getBoundingClientRect()
            const boundary = Math.round((((clientX - grabRef.current) - rect.left) / rect.width) * totalDays)
            const idx = edge === 'start' ? boundary : boundary - 1
            return addDays(from, Math.min(totalDays - 1, Math.max(0, idx)))
          }
          const move = (day) => {
            if (!day) return
            if (edge === 'start') onRangeChange(selected.id, { start_date: day >= selected.end_date ? addDays(selected.end_date, -1) : day, end_date: selected.end_date })
            else onRangeChange(selected.id, { start_date: selected.start_date, end_date: day <= selected.start_date ? addDays(selected.start_date, 1) : day })
          }
          const onKeyDown = (e) => {
            const step = e.shiftKey ? 7 : 1
            const delta = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -step : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? step : 0
            if (!delta) return
            e.preventDefault()
            const next = addDays(value, delta)
            if (next >= from && next <= to) move(next)
          }
          return (
            <div
              key={edge}
              role="slider"
              tabIndex={0}
              aria-label={edge === 'start' ? 'Term start' : 'Term end'}
              aria-valuemin={dayNumber(from)}
              aria-valuemax={dayNumber(to)}
              aria-valuenow={dayNumber(value)}
              aria-valuetext={formatDay(value)}
              title={`${edge === 'start' ? 'Start' : 'End'}: ${formatDay(value)} (drag, or use the arrow keys)`}
              onKeyDown={onKeyDown}
              onPointerDown={(e) => { e.preventDefault(); grabRef.current = e.clientX - edgePx(); e.currentTarget.setPointerCapture(e.pointerId) }}
              onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) move(dayAt(e.clientX)) }}
              // A 40px-wide target (finger sized) around a 12px grip. The start target leans left and the
              // end target leans right, so the two stay separately reachable on a short term.
              className="group absolute inset-y-0 z-10 w-10 cursor-ew-resize touch-none select-none focus:outline-none"
              style={{ left: `calc(${edge === 'start' ? style.left : style.left + style.width}% - ${edge === 'start' ? 28 : 12}px)` }}
            >
              <span
                className="absolute inset-y-0 flex w-3 items-center justify-center rounded bg-white shadow ring-1 ring-gray-900/60 group-focus-visible:ring-2 group-focus-visible:ring-primary-600"
                style={{ left: edge === 'start' ? 28 : 0 }}
              >
                <span className="h-4 w-0.5 rounded bg-gray-500" />
              </span>
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

      {!compact && (
        <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
          <div className="flex justify-between">
            <span>{formatDay(from)}</span>
            <span>{formatDay(to)}</span>
          </div>
          {(overlapping.size > 0 || gapDays > 0) && (
            <div className="mt-0.5 flex flex-wrap justify-center gap-x-3">
              {overlapping.size > 0 && <span className="font-medium text-red-600 dark:text-red-400">Terms overlap</span>}
              {gapDays > 0 && <span>{gapDays} days without a term</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
