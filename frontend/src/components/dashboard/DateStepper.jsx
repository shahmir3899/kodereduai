// Local-time YYYY-MM-DD. toISOString() is UTC, which reads as yesterday for the first hours
// of a local day east of Greenwich (e.g. 00:00–05:00 in Pakistan).
export function toLocalISODate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function shiftDate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number)
  return toLocalISODate(new Date(y, m - 1, d + days))
}

function formatLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

const arrowBtn = 'p-1 rounded text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed'

export default function DateStepper({ date, today, onChange }) {
  const isToday = date >= today
  return (
    <div className="flex items-center gap-1 text-xs text-gray-700">
      <button type="button" aria-label="Previous day" className={arrowBtn} onClick={() => onChange(shiftDate(date, -1))}>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
      </button>
      <span className="min-w-[7rem] text-center font-medium tabular-nums">{isToday ? 'Today' : formatLabel(date)}</span>
      <button type="button" aria-label="Next day" className={arrowBtn} disabled={isToday} onClick={() => onChange(shiftDate(date, 1))}>
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
      </button>
    </div>
  )
}
