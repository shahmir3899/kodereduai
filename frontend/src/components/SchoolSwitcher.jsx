import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'

export default function SchoolSwitcher() {
  const { user, activeSchool, switchSchool } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  const schools = user?.schools || []

  // Close on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Don't render if user has only one school
  if (schools.length <= 1) {
    return <span className="text-sm font-medium text-gray-700">{activeSchool?.name || user?.school_name}</span>
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors text-sm font-medium text-gray-700"
      >
        {activeSchool?.name || 'Select School'}
        <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 max-h-64 overflow-y-auto">
          {schools.map((school) => (
            <button
              key={school.id}
              onClick={() => {
                if (school.id !== activeSchool?.id) {
                  switchSchool(school.id)
                }
                setOpen(false)
              }}
              className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center justify-between ${
                school.id === activeSchool?.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
              }`}
            >
              <span>{school.name}</span>
              <span className="text-xs text-gray-400">{school.role === 'SUPER_ADMIN' ? 'Super' : school.role === 'SCHOOL_ADMIN' ? 'Admin' : 'Staff'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
