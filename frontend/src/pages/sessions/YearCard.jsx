import { useEffect, useRef, useState } from 'react'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import { yearBadges } from '../../components/academic/academicTones'
import YearTimeline from '../../components/timeline/YearTimeline'
import { formatDay } from './termDefaults'

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-700/50">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <p className="text-base font-semibold text-gray-900 dark:text-gray-100">{value ?? '-'}</p>
    </div>
  )
}

/** The less-used actions, kept behind one menu so the card has a single obvious button. */
function OverflowMenu({ items }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <Button variant="ghost" size="icon" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" /></svg>
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); item.onClick() }}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 ${item.danger ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-200'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * One academic year: name and status, dates, its terms on a timeline, a few counts, and one primary
 * action (Manage terms). Edit, Set current and Delete live in the overflow menu.
 */
export default function YearCard({ year, activeYearId, terms, classesCount, onManageTerms, onEdit, onSetCurrent, onDelete }) {
  const isViewing = year.id === activeYearId
  const menu = [
    ...(year.is_current ? [] : [{ label: 'Set as current year', onClick: onSetCurrent }]),
    { label: 'Edit dates and name', onClick: onEdit },
    { label: 'Delete year', onClick: onDelete, danger: true },
  ]

  return (
    <div className={`card border-2 dark:bg-gray-800 ${isViewing ? 'border-primary-400 dark:border-primary-600' : year.is_current ? 'border-green-400 dark:border-green-700' : 'border-transparent'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-gray-900 dark:text-gray-100">{year.name}</h3>
          <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">{formatDay(year.start_date)} - {formatDay(year.end_date)}</p>
        </div>
        <OverflowMenu items={menu} />
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {yearBadges(year, activeYearId).map((b) => (
          <Badge key={b.key} tone={b.tone}>{b.label}</Badge>
        ))}
      </div>

      <div className="mt-3">
        <YearTimeline year={year} terms={terms} onTermClick={onManageTerms} />
      </div>

      <div className={`mt-3 grid gap-2 ${classesCount !== undefined ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <Stat label="Students" value={year.enrollment_count} />
        {classesCount !== undefined && <Stat label="Classes" value={classesCount} />}
        <Stat label="Terms" value={year.terms_count ?? terms.length} />
      </div>

      <Button className="mt-3 w-full" variant={terms.length === 0 ? 'primary' : 'secondary'} onClick={onManageTerms}>
        {terms.length === 0 ? 'Add terms' : 'Manage terms'}
      </Button>
    </div>
  )
}
