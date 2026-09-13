/**
 * Table/Cards segmented control, paired with useViewPreference. Hidden below
 * the sm breakpoint since useViewPreference forces 'cards' there anyway.
 */
export default function ViewToggle({ view, onChange, className = '' }) {
  return (
    <div className={`hidden sm:inline-flex items-center bg-gray-100 rounded-lg p-0.5 ${className}`}>
      <button
        type="button"
        onClick={() => onChange('table')}
        aria-pressed={view === 'table'}
        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
          view === 'table' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        Table
      </button>
      <button
        type="button"
        onClick={() => onChange('cards')}
        aria-pressed={view === 'cards'}
        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
          view === 'cards' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        Cards
      </button>
    </div>
  )
}
