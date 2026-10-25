import { useState, useRef, useEffect } from 'react'
import { useAcademicYear } from '../contexts/AcademicYearContext'
import Badge from './ui/Badge'
import { formatDay } from '../pages/sessions/termDefaults'
import { yearBadges } from './academic/academicTones'

export default function AcademicYearSwitcher({ disabled = false, align = 'right' }) {
  const { academicYears, activeAcademicYear, currentTerm, switchAcademicYear, loading } = useAcademicYear()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Close dropdown when disabled (e.g. navigating to non-session page)
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  if (loading || academicYears.length === 0) {
    return (
      <span className="text-xs text-gray-400 px-2 py-1">
        {loading ? '' : 'No session'}
      </span>
    )
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => !disabled && setOpen(!open)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-colors text-xs font-medium ${
          disabled
            ? 'border-gray-100 text-gray-300 bg-gray-50 cursor-default'
            : 'border-gray-200 text-gray-600 bg-white hover:bg-gray-50 cursor-pointer dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
        }`}
        title={disabled ? 'Session filter is not applicable on this page' : undefined}
      >
        <svg className={`w-3.5 h-3.5 ${disabled ? 'text-gray-200' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span>{activeAcademicYear?.name || 'Select Year'}</span>
        {currentTerm && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${disabled ? 'bg-gray-100 text-gray-300' : 'bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'}`}>{currentTerm.name}</span>
        )}
        {!disabled && (
          <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {open && (
        <div className={`absolute top-full ${align === 'left' ? 'left-0' : 'right-0'} mt-1 w-72 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 dark:bg-gray-800 dark:border-gray-700 max-h-80 overflow-y-auto`}>
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider dark:text-gray-400">Academic Session</p>
          </div>
          {academicYears.map((year) => (
            <button
              key={year.id}
              onClick={() => {
                switchAcademicYear(year.id)
                setOpen(false)
              }}
              className={`w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-between ${
                year.id === activeAcademicYear?.id ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300' : 'text-gray-700 dark:text-gray-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{year.name}</span>
                {yearBadges(year, null).map(b => (
                  <Badge key={b.key} tone={b.tone} className="!px-1.5 !py-0 !text-[10px]">{b.label}</Badge>
                ))}
              </div>
              <span className="text-right text-xs text-gray-400 dark:text-gray-500">
                {formatDay(year.start_date)} - {formatDay(year.end_date)}
                {year.terms_count !== undefined && <span className="block">{year.terms_count} term{year.terms_count === 1 ? '' : 's'}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
