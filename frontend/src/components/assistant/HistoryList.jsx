import { useState } from 'react'

function when(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return d.toLocaleDateString()
}

/** Past conversations: pinned first, then newest. Opening one replaces the chat; deleting asks once. */
export default function HistoryList({ query, currentId, onOpen, onPin, onDelete, onClose }) {
  const [confirming, setConfirming] = useState(null)
  const [failed, setFailed] = useState('')
  const rows = [...(query.data || [])].sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.last_active) - new Date(a.last_active))

  const run = async (fn) => {
    setFailed('')
    try { await fn() } catch { setFailed('That did not work. Please try again.') }
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto" data-testid="history-list">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <p className="text-sm font-medium text-slate-900">Past conversations</p>
        <button type="button" onClick={onClose} className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">Back</button>
      </div>
      {failed && <p role="alert" className="mx-3 mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{failed}</p>}
      {query.isLoading && <p className="p-3 text-xs text-slate-500">Loading…</p>}
      {query.isError && <p role="alert" className="p-3 text-xs text-red-700">Could not load your conversations.</p>}
      {!query.isLoading && !query.isError && rows.length === 0 && <p className="p-3 text-xs text-slate-500">Nothing here yet. Your conversations will appear after you ask Aura something.</p>}
      <ul className="divide-y divide-slate-100">
        {rows.map((c) => (
          <li key={c.id} className={`flex items-center gap-2 px-3 py-2 ${c.id === currentId ? 'bg-slate-50' : ''}`}>
            <button type="button" onClick={() => onOpen(c.id)} className="min-w-0 flex-1 text-left">
              <span dir="auto" className="block truncate text-sm text-slate-900">{c.title || 'New conversation'}</span>
              <span className="text-[11px] text-slate-500">{when(c.last_active)}</span>
            </button>
            <button
              type="button"
              aria-pressed={c.pinned}
              aria-label={c.pinned ? `Unpin ${c.title || 'conversation'}` : `Pin ${c.title || 'conversation'}`}
              onClick={() => run(() => onPin(c.id, !c.pinned))}
              className="rounded px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
            >
              {c.pinned ? 'Pinned' : 'Pin'}
            </button>
            {confirming === c.id ? (
              <span className="flex items-center gap-1">
                <button type="button" onClick={() => { setConfirming(null); run(() => onDelete(c.id)) }} className="rounded bg-red-600 px-2 py-0.5 text-xs text-white">Delete</button>
                <button type="button" onClick={() => setConfirming(null)} className="rounded px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100">Keep</button>
              </span>
            ) : (
              <button type="button" aria-label={`Delete ${c.title || 'conversation'}`} onClick={() => setConfirming(c.id)} className="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100">Delete</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
