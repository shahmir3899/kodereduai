import { useState, useRef, useEffect, useMemo } from 'react'

/**
 * Lightweight searchable select dropdown (zero external dependencies).
 *
 * Props:
 *  - options: [{ value: string, label: string }]
 *  - value: string (selected value)
 *  - onChange: (value: string) => void
 *  - placeholder: string
 *  - disabled: boolean
 *  - required: boolean
 *  - isLoading: boolean
 *  - className: string (applied to outer wrapper)
 */
export default function SearchableSelect({
  options = [],
  value,
  onChange,
  placeholder = 'Search...',
  disabled = false,
  required = false,
  isLoading = false,
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [highlightIdx, setHighlightIdx] = useState(0)
  const containerRef = useRef(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  const selectedOption = options.find(o => String(o.value) === String(value))

  const filtered = useMemo(() => {
    if (!search.trim()) return options
    const q = search.toLowerCase()
    return options.filter(o => o.label.toLowerCase().includes(q))
  }, [options, search])

  // Reset highlight when filtered list changes
  useEffect(() => { setHighlightIdx(0) }, [filtered.length])

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.children[highlightIdx]
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [highlightIdx, open])

  const handleSelect = (val) => {
    onChange(val)
    setOpen(false)
    setSearch('')
  }

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightIdx(i => Math.min(i + 1, filtered.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightIdx(i => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (filtered[highlightIdx]) handleSelect(filtered[highlightIdx].value)
        break
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        setSearch('')
        break
    }
  }

  const handleTriggerClick = () => {
    if (disabled) return
    setOpen(true)
    setSearch('')
    // Focus the search input after render
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleClear = (e) => {
    e.stopPropagation()
    onChange('')
    setSearch('')
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Hidden input for form validation */}
      {required && (
        <input
          tabIndex={-1}
          value={value || ''}
          required
          onChange={() => {}}
          style={{ position: 'absolute', opacity: 0, height: 0, width: 0, pointerEvents: 'none' }}
        />
      )}

      {/* Trigger button */}
      {!open ? (
        <button
          type="button"
          onClick={handleTriggerClick}
          disabled={disabled}
          className="input-field w-full text-left flex items-center justify-between gap-2 min-h-[38px]"
        >
          <span className={selectedOption ? 'text-gray-900' : 'text-gray-400'}>
            {isLoading ? 'Loading...' : selectedOption ? selectedOption.label : placeholder}
          </span>
          <span className="flex items-center gap-1 flex-shrink-0">
            {value && !disabled && (
              <span
                onClick={handleClear}
                className="text-gray-400 hover:text-gray-600 px-0.5 cursor-pointer"
                title="Clear"
              >
                &times;
              </span>
            )}
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </span>
        </button>
      ) : (
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="input-field w-full"
          autoFocus
        />
      )}

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {isLoading ? (
            <div className="px-3 py-2 text-sm text-gray-400">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-400">
              {search ? 'No matches found' : 'No options available'}
            </div>
          ) : (
            <div ref={listRef}>
              {filtered.map((opt, idx) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleSelect(opt.value)}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    idx === highlightIdx
                      ? 'bg-primary-50 text-primary-700'
                      : String(opt.value) === String(value)
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
