import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'

export default function SchoolSwitcher() {
  const { user, activeSchool, switchSchool, isSwitchingSchool } = useAuth()
  const { showSuccess } = useToast()
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
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

  const handleSwitchSchool = async (school) => {
    if (school.id === activeSchool?.id) {
      setOpen(false)
      return
    }

    setSwitching(true)
    showSuccess(`Switching to ${school.name}...`)

    try {
      // switchSchool updates school context and refreshes data in-app.
      await switchSchool(school.id)
      setOpen(false)
    } catch (err) {
      console.error('School switch failed:', err)
    } finally {
      setSwitching(false)
    }
  }

  // Don't render if user has only one school
  if (schools.length <= 1) {
    return <span className="text-sm font-medium text-gray-700">{activeSchool?.name || user?.school_name}</span>
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        disabled={switching || isSwitchingSchool}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors text-sm font-medium text-gray-700 disabled:opacity-50"
      >
        📚 {activeSchool?.name || 'Select School'}
        <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 w-72 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 max-h-80 overflow-y-auto">
          {schools.map((school) => (
            <button
              key={school.id}
              onClick={() => handleSwitchSchool(school)}
              disabled={switching || isSwitchingSchool}
              className={`w-full text-left px-4 py-3 text-sm hover:bg-gray-50 flex items-center justify-between transition-colors disabled:opacity-50 ${
                school.id === activeSchool?.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'
              }`}
            >
              <div className="flex flex-col">
                <span className="font-medium">{school.name}</span>
                {school.address && <span className="text-xs text-gray-500">{school.address}</span>}
              </div>
              {school.id === activeSchool?.id && (
                <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
