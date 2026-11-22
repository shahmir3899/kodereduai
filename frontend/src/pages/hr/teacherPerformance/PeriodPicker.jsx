import { useState } from 'react'
import { currentMonth, monthRange } from './shared'

/** Month or custom range state for the teacher performance pages. */
export function usePeriod() {
  const [mode, setMode] = useState('month')
  const [month, setMonth] = useState(currentMonth())
  const [custom, setCustom] = useState(() => monthRange(currentMonth()))
  const range = mode === 'month' ? monthRange(month) : custom
  return { mode, setMode, month, setMonth, custom, setCustom, range }
}

export default function PeriodPicker({ mode, setMode, month, setMonth, custom, setCustom }) {
  const control = 'rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800'
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select aria-label="Period type" className={control} value={mode} onChange={(e) => setMode(e.target.value)}>
        <option value="month">Month</option>
        <option value="custom">Custom range</option>
      </select>
      {mode === 'month' ? (
        <input
          type="month" aria-label="Month" className={control} value={month} max={currentMonth()}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
      ) : (
        <>
          <input
            type="date" aria-label="From" className={control} value={custom.start}
            onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))}
          />
          <span className="text-gray-500">to</span>
          <input
            type="date" aria-label="To" className={control} value={custom.end}
            onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))}
          />
        </>
      )}
    </div>
  )
}
