/**
 * Standard dashboard header so every role page opens the same way.
 * @param {object} props
 * @param {string} [props.title='Dashboard']
 * @param {string} [props.subtitle] - e.g. school / academic year / term
 * @param {string|null} [props.offDayLabel] - shows a pill when today is an off day
 * @param {React.ReactNode} [props.children] - page body
 */
export default function DashboardShell({ title = 'Dashboard', subtitle, offDayLabel, children }) {
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{title}</h1>
          {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-500">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          {offDayLabel && (
            <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-700 font-semibold">{offDayLabel}</span>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}
