import { useEffect, useRef, useState } from 'react'

function formatDate(d) {
  return d.toISOString().slice(0, 10)
}

function currentMonthRange(offsetMonths = 0) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + offsetMonths + 1, 0)
  return { date_from: formatDate(start), date_to: formatDate(end) }
}

/**
 * Dropdown for picking a reporting period before generating a student report.
 * Calls onSelect({ date_from, date_to }) for month presets/custom range,
 * or onSelect({ academic_year }) for the "This Academic Year" preset.
 */
export default function ReportPeriodPicker({
  label,
  activeAcademicYearId,
  onSelect,
  disabled,
  buttonClassName = 'px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50 flex items-center gap-1',
  openUpward = false,
}) {
  const [open, setOpen] = useState(false)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const choose = (params) => {
    setOpen(false)
    onSelect(params)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className={buttonClassName}
      >
        {label}
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className={`absolute right-0 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-20 p-2 text-sm text-gray-700 ${openUpward ? 'bottom-full mb-1' : 'mt-1'}`}>
          <button
            onClick={() => choose(currentMonthRange(0))}
            className="w-full text-left px-3 py-2 rounded hover:bg-gray-50 text-gray-700"
          >
            This Month
          </button>
          <button
            onClick={() => choose(currentMonthRange(-1))}
            className="w-full text-left px-3 py-2 rounded hover:bg-gray-50 text-gray-700"
          >
            Last Month
          </button>
          <button
            onClick={() => choose(activeAcademicYearId ? { academic_year: activeAcademicYearId } : {})}
            disabled={!activeAcademicYearId}
            className="w-full text-left px-3 py-2 rounded hover:bg-gray-50 text-gray-700 disabled:opacity-40"
          >
            This Academic Year
          </button>
          <div className="border-t border-gray-100 mt-2 pt-2">
            <p className="px-3 text-xs text-gray-500 mb-1">Custom Range</p>
            <div className="flex items-center gap-1 px-3">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="border border-gray-200 rounded px-1.5 py-1 text-xs w-full text-gray-700"
              />
              <span className="text-gray-400">-</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="border border-gray-200 rounded px-1.5 py-1 text-xs w-full text-gray-700"
              />
            </div>
            <button
              onClick={() => customFrom && customTo && choose({ date_from: customFrom, date_to: customTo })}
              disabled={!customFrom || !customTo}
              className="w-full mt-2 px-3 py-1.5 bg-gray-100 rounded hover:bg-gray-200 text-gray-700 disabled:opacity-40 text-xs font-medium"
            >
              Apply Custom Range
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
