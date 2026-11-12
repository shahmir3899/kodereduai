import { useEscapeKey } from '../../../hooks/useEscapeKey'

// Right-side panel used by both parent-link drawers. Mount only while open.
export default function DrawerShell({ title, subtitle, onClose, children }) {
  useEscapeKey(onClose, true)
  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white w-full max-w-lg h-full shadow-xl flex flex-col" role="dialog" aria-label={title}>
        <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 truncate">{title}</h2>
            {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-6">{children}</div>
      </div>
    </div>
  )
}

export function Section({ title, children }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{title}</h3>
      {children}
    </section>
  )
}
