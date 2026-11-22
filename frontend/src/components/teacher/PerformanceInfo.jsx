import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { teacherPerformanceApi } from '../../services/api'

/**
 * The "how is this scored?" info button shown next to every teacher performance score or rank.
 *
 * Opens on hover and on keyboard focus (and on click, for touch screens, which have no hover).
 * The text comes from the explainer endpoint, which builds it from the school's own settings,
 * so it always states the real cut-off time, deadlines and weights.
 *
 * Props:
 *   measure  – a measure key: show only that measure's rule and weight (for a per-measure button)
 *   wins     – a teacher's quickest wins ([{key, label, points_available}]) to list at the bottom
 *   label    – accessible name of the button
 */
export default function PerformanceInfo({ measure, wins, label = 'How the score works' }) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const ref = useRef(null)
  const buttonRef = useRef(null)
  const panelId = useId()
  const [pos, setPos] = useState(null)

  // Fixed position worked out from the button, kept inside the viewport: the button can sit at
  // the right edge (detail header), mid-card, or near the bottom of a phone screen.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return undefined
    function place() {
      const r = buttonRef.current.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const width = Math.min(352, vw - 32)
      const left = Math.min(Math.max(16, r.left - 12), vw - width - 16)
      const below = vh - r.bottom - 20
      if (below >= 220 || below >= r.top) {
        setPos({ left, width, top: r.bottom + 4, maxHeight: Math.min(below, vh * 0.6) })
      } else {
        setPos({ left, width, bottom: vh - r.top + 4, maxHeight: Math.min(r.top - 20, vh * 0.6) })
      }
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  const { data, isLoading } = useQuery({
    queryKey: ['teacher-performance-explainer'],
    // The admin pages pass their own wins; skip the server's "my month" computation for them.
    queryFn: () => teacherPerformanceApi.getExplainer({ include_mine: 0 }).then((r) => r.data),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    if (!pinned) return undefined
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setPinned(false)
        setOpen(false)
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        setPinned(false)
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [pinned])

  const measures = data?.measures || []
  const shown = measure ? measures.filter((m) => m.key === measure) : measures

  return (
    <span
      ref={ref}
      className="relative inline-flex align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => !pinned && setOpen(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          if (!pinned && !ref.current?.contains(e.relatedTarget)) setOpen(false)
        }}
        onClick={() => {
          setPinned((p) => !p)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setPinned(false)
            setOpen(false)
          }
        }}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-xs font-semibold text-gray-500 hover:border-primary-400 hover:text-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:text-gray-400"
      >
        i
      </button>
      {open && (
        <div
          id={panelId}
          role="tooltip"
          style={pos || { visibility: 'hidden' }}
          className="fixed z-50 overflow-y-auto rounded-lg border border-gray-200 bg-white p-3 text-left text-xs font-normal text-gray-700 shadow-lg dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
        >
          {isLoading || !data ? (
            <p className="text-gray-500">Loading…</p>
          ) : (
            <>
              {!measure && (
                <ul className="mb-2 list-disc space-y-1 pl-4">
                  {data.general.map((line) => <li key={line}>{line}</li>)}
                </ul>
              )}
              <ul className="space-y-1.5">
                {shown.map((m) => (
                  <li key={m.key}>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{m.label}</span>
                    <span className="text-gray-500"> · weight {Number(m.weight)}</span>
                    <div>{m.rule}</div>
                  </li>
                ))}
              </ul>
              {!measure && data.bands?.length > 0 && (
                <p className="mt-2 text-gray-500">
                  Bands: {data.bands.map((b) => `${b.label} ${b.min}+`).join(' · ')}
                </p>
              )}
              {wins?.length > 0 && (
                <div className="mt-2 border-t border-gray-100 pt-2 dark:border-gray-700">
                  <p className="font-semibold text-gray-900 dark:text-gray-100">Quickest wins</p>
                  <ul className="list-disc pl-4">
                    {wins.map((w) => (
                      <li key={w.key}>{w.label}: up to {w.points_available} points</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </span>
  )
}
