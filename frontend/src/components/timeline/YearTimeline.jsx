import { formatDay } from '../../pages/sessions/termDefaults'
import { dayNumber, findGaps, findOverlaps, positionPercent, spanStyle, todayIso } from './timelineMath'

// Written out in full so Tailwind's scanner sees every class.
const TERM_COLOURS = ['bg-primary-500', 'bg-teal-500', 'bg-amber-500', 'bg-purple-500', 'bg-pink-500', 'bg-sky-500']

// Diagonal hatching marks uncovered days without needing another colour.
const HATCH = {
  backgroundImage: 'repeating-linear-gradient(45deg, rgba(148,163,184,0.55) 0 3px, transparent 3px 7px)',
}

/**
 * One academic year as a bar with its terms drawn inside it: hatched stretches are days no term
 * covers, red-ringed terms overlap another term, and a line marks today. Read-only; the term
 * modal owns editing.
 *
 * `draft` is an optional unsaved term ({start_date, end_date, name}) drawn on top while the term
 * form is being filled in, so overlaps show up before Save.
 */
export default function YearTimeline({ year, terms = [], draft = null, onTermClick, compact = false }) {
  if (!year?.start_date || !year?.end_date) return null
  const { start_date: from, end_date: to } = year

  const all = draft?.start_date && draft?.end_date ? [...terms.filter(t => t.id !== draft.id), { ...draft, id: draft.id ?? 'draft' }] : terms
  const overlapping = findOverlaps(all)
  const gaps = findGaps(all, from, to)
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
        role="img"
        aria-label={summary}
        className={`relative w-full overflow-hidden rounded-md bg-gray-100 dark:bg-gray-700 ${compact ? 'h-6' : 'h-9'}`}
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
              className={`absolute inset-y-0.5 flex items-center overflow-hidden rounded px-1.5 text-left text-[11px] font-medium leading-none text-white ${TERM_COLOURS[i % TERM_COLOURS.length]} ${clash ? 'ring-2 ring-red-500 ring-inset' : ''} ${onTermClick ? 'cursor-pointer hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white' : ''}`}
              style={{ left: `${style.left}%`, width: `${style.width}%` }}
            >
              <span className="truncate">{term.name}</span>
            </Tag>
          )
        })}

        {draft?.start_date && draft?.end_date && (() => {
          const style = spanStyle(draft.start_date, draft.end_date, from, to)
          return style && (
            <div
              title={`${draft.name || 'New term'} (unsaved)`}
              className={`pointer-events-none absolute inset-y-0 rounded border-2 border-dashed ${overlapping.has(draft.id ?? 'draft') ? 'border-red-500 bg-red-500/20' : 'border-gray-700 bg-white/40 dark:border-gray-200 dark:bg-white/20'}`}
              style={{ left: `${style.left}%`, width: `${style.width}%` }}
            />
          )
        })()}

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
