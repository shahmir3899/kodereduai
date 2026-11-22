import { useMemo, useState } from 'react'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import { pickerGroups } from './blockDocument'

/**
 * Choosing a question type: grouped by what the teacher wants to ask, searchable, with the types already in the
 * paper first. ``multiple`` (Structure): tap several types, each tap adds one more, then add them all as rows.
 * Otherwise one tap picks a type and closes.
 */
export default function TypePicker({ open, onClose, registry, early = false, used = [], layout = true, multiple = false, title, onPick, onAddMany }) {
  const [search, setSearch] = useState('')
  const [counts, setCounts] = useState({})
  const sections = useMemo(() => pickerGroups(registry, { early, used, search, layout }), [registry, early, used, search, layout])
  const chosen = Object.entries(counts).filter(([, n]) => n > 0)
  const totalChosen = chosen.reduce((sum, [, n]) => sum + n, 0)
  const close = () => { setSearch(''); setCounts({}); onClose() }
  const tap = (type) => {
    if (!multiple) { onPick(type); close(); return }
    setCounts((prev) => ({ ...prev, [type]: (prev[type] || 0) + 1 }))
  }
  const less = (type) => setCounts((prev) => ({ ...prev, [type]: Math.max(0, (prev[type] || 0) - 1) }))
  // Rows come out in the order the groups show them, so the paper reads in a sensible order.
  const order = sections.flatMap((section) => section.types.map((spec) => spec.type))
  const addAll = () => {
    const picked = [...new Set(order)].filter((type) => counts[type] > 0).map((type) => ({ type, count: counts[type] }))
    onAddMany(picked)
    close()
  }

  if (!open) return null
  return (
    <Modal open onClose={close} title={title || (multiple ? 'Add questions' : 'Add a question')} size="4xl">
      <div className="space-y-4">
        {/* Search and the add button stay in view: the list is long and a button below it was off screen. */}
        <div className="sticky -top-4 sm:-top-6 z-10 bg-white dark:bg-gray-800 py-2 flex gap-2 items-center">
        <input
          type="search"
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search question types"
          placeholder="Search: match, count, essay…"
          className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        {multiple && (
          <Button onClick={addAll} disabled={!totalChosen}>{totalChosen ? `Add ${totalChosen} row${totalChosen === 1 ? '' : 's'}` : 'Add rows'}</Button>
        )}
        </div>
        {multiple && <p className="text-xs text-gray-500">Tap a type once for each question you want. Tap again for another of the same type.</p>}
        {sections.length === 0 && <p className="text-sm text-gray-500">No question type matches “{search}”.</p>}
        {sections.map((section) => (
          <section key={section.id} aria-label={section.label}>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">{section.label}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {section.types.map((spec) => {
                const n = counts[spec.type] || 0
                return (
                  <div key={`${section.id}-${spec.type}`} className={`relative rounded-lg border ${n ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-400 hover:bg-blue-50'}`}>
                    <button type="button" onClick={() => tap(spec.type)} className="w-full text-left px-3 py-2">
                      <span className="block text-sm font-medium text-gray-900 pr-10">{spec.label}</span>
                      {spec.hint && <span className="block text-xs text-gray-500 mt-0.5">{spec.hint}</span>}
                    </button>
                    {n > 0 && (
                      <span className="absolute top-1.5 right-1.5 flex items-center gap-1">
                        <button type="button" aria-label={`One less ${spec.label}`} onClick={() => less(spec.type)}
                          className="w-5 h-5 rounded-full bg-white border border-blue-300 text-blue-700 text-xs leading-none">−</button>
                        <span className="text-xs font-semibold text-blue-700" aria-label={`${n} ${spec.label}`}>×{n}</span>
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  )
}
