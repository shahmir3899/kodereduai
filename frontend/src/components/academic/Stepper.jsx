/**
 * Numbered step pills used by the first-run Years page and the AI setup wizard, so both show
 * progress the same way. `current` is 1-based; earlier steps show a tick.
 */
export default function Stepper({ steps, current, className = '' }) {
  return (
    <ol className={`flex flex-wrap items-center gap-2 ${className}`} aria-label="Progress">
      {steps.map((label, i) => {
        const n = i + 1
        const done = n < current
        const active = n === current
        return (
          <li key={label} className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
            <span
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ${
                active
                  ? 'bg-primary-100 text-primary-700 ring-2 ring-primary-300 dark:bg-primary-900/40 dark:text-primary-300 dark:ring-primary-700'
                  : done
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                    : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-400'
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold text-white ${
                  active ? 'bg-primary-500' : done ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-500'
                }`}
              >
                {done ? '✓' : n}
              </span>
              {label}
            </span>
            {n < steps.length && (
              <svg className="h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            )}
          </li>
        )
      })}
    </ol>
  )
}
