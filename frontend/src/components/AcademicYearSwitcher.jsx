import { useState, useRef, useEffect } from 'react'
import { useAcademicYear } from '../contexts/AcademicYearContext'

export default function AcademicYearSwitcher() {
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
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-xs font-medium text-gray-600 bg-white"
      >
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span>{activeAcademicYear?.name || 'Select Year'}</span>
        {currentTerm && (
          <span className="text-gray-400">| {currentTerm.name}</span>
        )}
        <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-72 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 max-h-80 overflow-y-auto">
          <div className="px-3 py-2 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Academic Session</p>
          </div>
          {academicYears.map((year) => (
            <button
              key={year.id}
              onClick={() => {
                switchAcademicYear(year.id)
                setOpen(false)
              }}
              className={`w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 flex items-center justify-between ${
                year.id === activeAcademicYear?.id ? 'bg-sky-50 text-sky-700' : 'text-gray-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{year.name}</span>
                {year.is_current && (
                  <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-green-100 text-green-700 rounded">
                    CURRENT
                  </span>
                )}
              </div>
              <span className="text-xs text-gray-400">
                {year.start_date?.slice(0, 7)} - {year.end_date?.slice(0, 7)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
