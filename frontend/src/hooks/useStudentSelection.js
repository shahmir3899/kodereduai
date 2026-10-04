import { useCallback, useState } from 'react'

// Which students are ticked for bulk actions (create accounts, download reports).
// `selectable` is the list the "select all" box applies to.
export function useStudentSelection(selectable) {
  const [selectedIds, setSelectedIds] = useState(new Set())

  const toggle = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => (
      prev.size === selectable.length && selectable.length > 0
        ? new Set()
        : new Set(selectable.map((s) => s.id))
    ))
  }, [selectable])

  const clear = useCallback(() => setSelectedIds(new Set()), [])

  return { selectedIds, toggle, toggleAll, clear }
}
