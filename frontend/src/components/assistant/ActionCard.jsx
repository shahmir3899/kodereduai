import { useMemo, useState } from 'react'
import FeedbackThumbs from './FeedbackThumbs'
import { ATTENDANCE_STATUSES, CARD_KINDS, buildEdits, cellsFor, isEditable } from './cardConfig'

const VISIBLE_ROWS = 8

const CONFLICT_LABELS = { skip: 'keep existing plans', add: 'add alongside', replace: 'replace existing drafts' }
const MINUTES = [30, 40, 45, 60, 90]
const CHIP_KEYS = ['saturday', 'on_conflict', 'minutes']

/** The assumptions a lesson-plan card was built on, as controls. Each change asks the server to rebuild the card. */
function PlanChips({ chips, disabled, onChange }) {
  const minutes = MINUTES.includes(chips.duration_minutes) ? MINUTES : [...MINUTES, chips.duration_minutes].sort((a, b) => a - b)
  const chip = 'rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-50'
  return (
    <div className="mb-2" data-testid="plan-chips">
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" disabled={disabled} className={chip} aria-label="Saturday" onClick={() => onChange({ skip_saturday: !chips.skip_saturday })}>
          Saturday: {chips.skip_saturday ? 'skipped' : 'taught'}
        </button>
        <select aria-label="If a plan already exists" disabled={disabled} className={chip} value={chips.on_conflict} onChange={(e) => onChange({ on_conflict: e.target.value })}>
          {Object.entries(CONFLICT_LABELS).map(([k, label]) => <option key={k} value={k}>If a plan exists: {label}</option>)}
        </select>
        <select aria-label="Lesson length" disabled={disabled} className={chip} value={chips.duration_minutes} onChange={(e) => onChange({ duration_minutes: Number(e.target.value) })}>
          {minutes.map((m) => <option key={m} value={m}>{m} min</option>)}
        </select>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">Changing Saturday plans the dates again; edits made on this card are lost.</p>
    </div>
  )
}

function Assumptions({ data, hide = [] }) {
  const items = Object.entries(data || {}).filter(([k, v]) => !hide.includes(k) && v !== '' && v !== null && v !== undefined)
  if (!items.length) return null
  return (
    <div className="mb-2 flex flex-wrap gap-1">
      {items.map(([k, v]) => (
        <span key={k} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
          {k.replace(/_/g, ' ')}: {Array.isArray(v) ? v.join(', ') : String(v)}
        </span>
      ))}
    </div>
  )
}

function resultLine(result) {
  if (!result) return 'Done'
  const parts = ['created', 'updated', 'saved', 'deleted']
    .filter((k) => typeof result[k] === 'number' && result[k] > 0)
    .map((k) => `${k} ${result[k]}`)
  if (typeof result.total_paid === 'number') parts.push(`Rs ${result.total_paid.toLocaleString()}`)
  if (typeof result.total === 'number' && result.total) parts.push(`Rs ${result.total.toLocaleString()}`)
  const failed = result.failed || (result.errors || []).length
  return (parts.join(' · ') || 'Done') + (failed ? ` · ${failed} could not be saved` : '')
}

export default function ActionCard({ action, note = {}, onApprove, onReject, onEdit }) {
  const preview = action.preview || {}
  const kind = preview.kind
  const cfg = CARD_KINDS[kind] || {}
  const cells = useMemo(() => cellsFor(kind), [kind])
  const rows = preview.rows || []
  const [editing, setEditing] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [draft, setDraft] = useState({ removed: new Set(), amounts: {}, statuses: {} })

  const open = action.can_act
  const visible = showAll || editing ? rows : rows.slice(0, VISIBLE_ROWS)
  const busy = Boolean(note.busy)

  const startEdit = () => {
    setDraft({ removed: new Set(), amounts: {}, statuses: {} })
    setEditing(true)
  }
  const toggleRemoved = (id) => setDraft((d) => {
    const removed = new Set(d.removed)
    if (removed.has(id)) removed.delete(id)
    else removed.add(id)
    return { ...d, removed }
  })
  const applyEdits = async () => {
    const edits = buildEdits(kind, rows, draft)
    if (Object.keys(edits).length) await onEdit(action.id, edits)
    setEditing(false)
  }

  const tone = action.status === 'executed' ? 'border-emerald-300' : action.status === 'failed' ? 'border-red-300' : 'border-slate-300'

  return (
    <div className={`mt-2 w-full rounded-xl border ${tone} bg-white p-3 text-sm shadow-sm`} data-testid="action-card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-slate-900" dir="auto">{preview.title || 'Change'}</p>
          <p className="text-xs text-slate-600" dir="auto">{preview.summary}</p>
        </div>
        {action.status !== 'pending' && action.status !== 'edited' && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] capitalize text-slate-600">{action.status}</span>
        )}
      </div>

      <div className="mt-2">
        {preview.editable?.chips && open && !busy && (
          <PlanChips chips={preview.editable.chips} disabled={busy} onChange={(edits) => onEdit(action.id, edits)} />
        )}
        <Assumptions data={preview.assumptions} hide={preview.editable?.chips && open ? CHIP_KEYS : []} />
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  {editing && cfg.removeAs && <th className="w-6" />}
                  {(preview.columns || []).map((c) => <th key={c} className="py-1 pr-2 font-medium">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const id = row[cfg.rowId ?? 'id']
                  const removed = draft.removed.has(id)
                  return (
                    <tr key={String(id)} className={`border-b border-slate-100 ${removed ? 'opacity-40 line-through' : ''}`}>
                      {editing && cfg.removeAs && (
                        <td className="py-1 pr-1">
                          <input type="checkbox" aria-label={`Remove row ${id}`} checked={removed} onChange={() => toggleRemoved(id)} />
                        </td>
                      )}
                      {cells.map(({ key, format }) => (
                        <td key={key} className="max-w-[12rem] py-1 pr-2 align-top" dir="auto">
                          {editing && cfg.amount?.key === key && !removed ? (
                            <input
                              type="number"
                              min="0"
                              aria-label={`Amount for ${row.student || row.description || id}`}
                              className="w-20 rounded border border-slate-300 px-1 py-0.5"
                              defaultValue={row[key]}
                              onChange={(e) => setDraft((d) => ({ ...d, amounts: { ...d.amounts, [id]: e.target.value } }))}
                            />
                          ) : editing && cfg.status?.key === key ? (
                            <select
                              aria-label={`Status for ${row.student || row.staff}`}
                              className="rounded border border-slate-300 px-1 py-0.5"
                              defaultValue={row[key]}
                              onChange={(e) => setDraft((d) => ({ ...d, statuses: { ...d.statuses, [id]: e.target.value } }))}
                            >
                              {(cfg.status.options || ATTENDANCE_STATUSES).map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          ) : (
                            <span className={key === 'status' && row[key] === 'ABSENT' ? 'font-medium text-red-700' : ''}>{format(row[key], row)}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > VISIBLE_ROWS && !editing && (
          <button type="button" className="mt-1 text-xs text-blue-700 underline" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show fewer' : `Show all ${rows.length}`}
          </button>
        )}
      </div>

      {preview.totals?.amount !== undefined || preview.totals?.paying !== undefined ? (
        <p className="mt-2 text-xs font-medium text-slate-800">
          Total Rs {(preview.totals.paying ?? preview.totals.amount).toLocaleString()}
        </p>
      ) : null}
      {preview.account && (
        <p className="text-xs text-slate-600">
          {preview.account.name}: Rs {preview.account.balance_before.toLocaleString()} → Rs {preview.account.balance_after.toLocaleString()}
          <span className="text-slate-400"> (estimate)</span>
        </p>
      )}
      {(preview.warnings || []).map((w) => (
        <p key={w} className="mt-1 text-xs text-amber-700" dir="auto">{w}</p>
      ))}
      {editing && cfg.note && <p className="mt-1 text-[11px] text-slate-500">{cfg.note}</p>}
      {note.error && <p role="alert" className="mt-2 text-xs text-red-700" dir="auto">{note.error}</p>}
      {action.status === 'failed' && action.error && <p className="mt-2 text-xs text-red-700" dir="auto">{action.error}</p>}
      {action.status === 'executed' && <p className="mt-2 text-xs text-emerald-700">{resultLine(action.result)}</p>}
      {(action.status === 'executed' || action.status === 'rejected') && <FeedbackThumbs messageId={action.message_id} label="Was this card right?" />}
      {action.status === 'expired' && <p className="mt-2 text-xs text-slate-500">This card expired. Ask again to prepare it.</p>}

      {open && (
        <div className="mt-3 flex gap-2">
          {editing ? (
            <>
              <button type="button" disabled={busy} onClick={applyEdits} className="flex-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Update card</button>
              <button type="button" disabled={busy} onClick={() => setEditing(false)} className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs">Cancel</button>
            </>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={() => onApprove(action.id)} className="flex-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                {busy ? 'Working…' : 'Approve'}
              </button>
              {isEditable(kind) && (
                <button type="button" disabled={busy} onClick={startEdit} className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50">Edit</button>
              )}
              <button type="button" disabled={busy} onClick={() => onReject(action.id)} className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50">Reject</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
