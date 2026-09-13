import { useState } from 'react'

/**
 * Nested-record card variant — a route summary row that expands in place to
 * its own stop list, for Transport Routes. See docs/CARD_SYSTEM.md: a route
 * *contains* stops, so RecordCard's flat field grid has no slot for that
 * relationship. Mirrors the existing expand/collapse-per-row behavior on the
 * desktop table (RoutesPage.jsx) rather than introducing a new interaction.
 *
 * stats: [{ label, value }] — shown right-aligned in the summary row (distance,
 *   stop count, capacity).
 * renderStops: () => node — deferred so the stop list (and its map view) only
 *   renders once expanded, matching today's lazy stops fetch per route.
 * open / onToggle: controlled mode — pass both when the page needs to know
 *   which route is expanded (e.g. to scope a single "fetch this route's
 *   stops" query, as RoutesPage.jsx does). Omit both for uncontrolled mode
 *   (the card manages its own open state internally).
 */
export default function RouteCard({ title, meta, stats = [], renderStops, onAddStop, open: openProp, onToggle }) {
  const isControlled = openProp !== undefined && !!onToggle
  const [internalOpen, setInternalOpen] = useState(false)
  const open = isControlled ? openProp : internalOpen
  const toggle = () => (isControlled ? onToggle() : setInternalOpen((o) => !o))

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <svg
            className={`w-4 h-4 text-gray-400 flex-none transition-transform ${open ? 'rotate-90 text-primary-600' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
          <div className="min-w-0">
            <div className="font-medium text-sm text-gray-900 truncate">{title}</div>
            {meta && <div className="text-xs text-gray-500 mt-0.5 truncate">{meta}</div>}
          </div>
        </div>
        <div className="flex items-center gap-4 flex-none">
          {stats.map((s, i) => (
            <div key={i} className="text-right">
              <div className="text-[9px] uppercase tracking-wide text-gray-400">{s.label}</div>
              <div className="font-mono text-xs text-gray-700">{s.value}</div>
            </div>
          ))}
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Stops on this route</h4>
            {onAddStop && (
              <button type="button" onClick={onAddStop} className="text-xs font-medium text-primary-600 hover:text-primary-700">
                + Add Stop
              </button>
            )}
          </div>
          {renderStops?.()}
        </div>
      )}
    </div>
  )
}
