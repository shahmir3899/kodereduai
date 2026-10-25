import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

const STATUS_STYLE = {
  done: { icon: '✓', dot: 'bg-green-500 text-white', text: 'text-gray-900 dark:text-gray-100' },
  pending: { icon: '', dot: 'bg-gray-200 dark:bg-gray-600', text: 'text-gray-700 dark:text-gray-200' },
  overdue: { icon: '!', dot: 'bg-amber-500 text-white', text: 'text-gray-900 dark:text-gray-100' },
}

/**
 * "Planned N%": how much of the year's advance setup is done. Opens a short checklist; each item that
 * is not done says what is missing and takes the admin straight to where it is fixed.
 */
export default function PlanningChip({ planning, isSchoolAdmin, onAddEntry }) {
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

  if (!planning || planning.percent == null) return null

  const overdue = planning.overdue > 0
  const fix = (item) => {
    const action = item.action || {}
    if (action.type === 'terms') return <Link to="/academics/sessions" className="text-xs text-primary-600 hover:underline">Open terms</Link>
    if (action.type === 'exams') return <Link to="/academics/exams" className="text-xs text-primary-600 hover:underline">Open exams</Link>
    if (action.type === 'entry' && isSchoolAdmin) {
      return <button type="button" onClick={() => { setOpen(false); onAddEntry(action) }} className="text-xs text-primary-600 hover:underline">Add entry</button>
    }
    return null
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${overdue
          ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-200'
          : 'border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-900/60 dark:bg-primary-900/20 dark:text-primary-300'}`}
      >
        Planned {planning.percent}%
        {overdue && <span>· {planning.overdue} overdue</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Year setup &middot; {planning.done} of {planning.total} done
          </p>
          <ul className="space-y-2">
            {planning.items.map((item) => {
              const style = STATUS_STYLE[item.status] || STATUS_STYLE.pending
              return (
                <li key={item.key} className="flex items-start gap-2">
                  <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${style.dot}`}>{style.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${style.text}`}>{item.label}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{item.detail}</p>
                  </div>
                  {item.status !== 'done' && fix(item)}
                </li>
              )
            })}
          </ul>

          {planning.hints?.length > 0 && (
            <div className="mt-3 border-t border-gray-100 pt-2 dark:border-gray-700">
              {planning.hints.map((hint) => (
                <div key={hint.key} className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-gray-600 dark:text-gray-300">{hint.label}: {hint.done ? 'entered' : 'not entered'}</p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500">{hint.note}</p>
                  </div>
                  {!hint.done && isSchoolAdmin && (
                    <button type="button" onClick={() => { setOpen(false); onAddEntry(hint.action) }} className="shrink-0 text-xs text-primary-600 hover:underline">Add</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
