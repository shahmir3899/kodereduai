import { useEffect, useRef, useState } from 'react'

export const MAX_REPORT_EXAMS = 4

/**
 * Multi-select of the class's exams. One tick is a single-exam card (the common case);
 * several combine them, with the last (newest) exam as the card's main exam. Exams arrive
 * oldest first and are grouped by term purely for scanning - term is no longer a filter.
 */
export function ExamPicker({ exams, selected, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const chosen = exams.filter(e => selected.includes(String(e.id)))
  const main = chosen[chosen.length - 1]
  const atLimit = selected.length >= MAX_REPORT_EXAMS

  const toggle = (id) => {
    const key = String(id)
    if (selected.includes(key)) {
      if (selected.length === 1) return // a card always has at least one exam
      onChange(selected.filter(x => x !== key))
    } else if (!atLimit) {
      onChange([...selected, key])
    }
  }

  const groups = []
  exams.forEach(e => {
    const label = e.term_name || 'No term'
    let group = groups.find(g => g.label === label)
    if (!group) { group = { label, exams: [] }; groups.push(group) }
    group.exams.push(e)
  })

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="input w-full text-sm text-left flex items-center justify-between gap-2 disabled:opacity-50"
      >
        <span className="truncate">
          {main ? main.name : (disabled ? 'Select class first' : 'Select exam...')}
          {chosen.length > 1 && <span className="text-gray-400"> +{chosen.length - 1} earlier</span>}
        </span>
        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full min-w-[16rem] bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-y-auto p-2">
          <p className="text-[11px] text-gray-500 px-1 pb-1">
            Tick one exam, or several to show earlier results beside the newest. The newest ticked exam decides the result.
          </p>
          {exams.length === 0 && <p className="text-sm text-gray-400 px-1 py-2">No exams for this class yet.</p>}
          {groups.map(group => (
            <div key={group.label} className="mb-1">
              <p className="text-[10px] font-semibold text-gray-400 uppercase px-1 pt-1">{group.label}</p>
              {group.exams.map(e => {
                const checked = selected.includes(String(e.id))
                const blocked = !checked && atLimit
                return (
                  <label
                    key={e.id}
                    className={`flex items-center gap-2 px-1 py-1 rounded text-sm ${blocked ? 'text-gray-300' : 'text-gray-800 hover:bg-gray-50 cursor-pointer'}`}
                  >
                    <input type="checkbox" checked={checked} disabled={blocked} onChange={() => toggle(e.id)} />
                    <span className="truncate">{e.name}</span>
                    {e.exam_type_name && <span className="text-[10px] text-gray-400 ml-auto flex-shrink-0">{e.exam_type_name}</span>}
                  </label>
                )
              })}
            </div>
          ))}
          {atLimit && <p className="text-[11px] text-amber-600 px-1 pt-1">At most {MAX_REPORT_EXAMS} exams on one card.</p>}
        </div>
      )}
    </div>
  )
}

/** One box: type to filter the class, click to pick; arrows step through the class. */
export function StudentPicker({ students, value, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQuery('') } }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const index = students.findIndex(s => String(s.id) === String(value))
  const current = index >= 0 ? students[index] : null
  const label = current ? `${current.student_name} (${current.roll_number})` : ''
  const matches = students.filter(s => !query || (s.student_name || '').toLowerCase().includes(query.toLowerCase()))

  const pick = (id) => { onChange(String(id)); setOpen(false); setQuery('') }
  const step = (delta) => {
    const next = students[index + delta]
    if (next) onChange(String(next.id))
  }

  return (
    <div className="flex items-center gap-1" ref={ref}>
      <button
        type="button" onClick={() => step(-1)} disabled={disabled || index <= 0}
        aria-label="Previous student" className="px-2 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-30"
      >&#9664;</button>
      <div className="relative flex-1 min-w-0">
        <input
          type="text"
          value={open ? query : label}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          disabled={disabled}
          placeholder={disabled ? 'Select class first' : 'Search student...'}
          className="input w-full text-sm"
          aria-label="Student"
        />
        {open && (
          <ul className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto py-1" role="listbox">
            {matches.length === 0 && <li className="px-3 py-2 text-sm text-gray-400">No students match.</li>}
            {matches.map(s => (
              <li key={s.id} role="option" aria-selected={String(s.id) === String(value)}>
                <button
                  type="button" onClick={() => pick(s.id)}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 ${String(s.id) === String(value) ? 'font-medium text-primary-700' : 'text-gray-800'}`}
                >
                  {s.student_name} <span className="text-gray-400">({s.roll_number})</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button" onClick={() => step(1)} disabled={disabled || index < 0 || index >= students.length - 1}
        aria-label="Next student" className="px-2 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-30"
      >&#9654;</button>
    </div>
  )
}
