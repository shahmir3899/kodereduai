// How each kind of change card is drawn and edited. The server sends `preview.kind`, `columns` (labels)
// and `rows`; the row keys differ per kind, so the mapping lives here, next to the edit rules.

const money = (v) => (typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v ?? '')

export const CARD_KINDS = {
  fee_payments: {
    cells: ['student', 'class', 'period', 'due', ['paying', money]],
    rowId: 'id', removeAs: 'remove_ids', amount: { key: 'paying', field: 'amounts', idKey: 'id' },
    note: 'Account, method and date can be changed by asking the assistant.',
  },
  expense_entries: { cells: ['date', 'category', 'description', ['amount', money]], rowId: 'key', removeAs: 'remove_keys', amount: { key: 'amount', field: 'amounts', idKey: 'key' } },
  income_entries: { cells: ['date', 'category', 'description', ['amount', money]], rowId: 'key', removeAs: 'remove_keys', amount: { key: 'amount', field: 'amounts', idKey: 'key' } },
  lesson_plans: { cells: ['date', 'weekday', 'section', 'content'], rowId: 'key', removeAs: 'remove_keys' },
  attendance: { cells: ['student', 'was', 'status'], rowId: 'student_id', status: { key: 'status', field: 'statuses' } },
  assignments: { cells: ['section', 'subject', 'type', 'text'], rowId: 'key', removeAs: 'remove_keys' },
  delete_lesson_plans: { cells: ['date', 'class', 'subject', 'title', 'status'], rowId: 'id', removeAs: 'remove_ids' },
  delete_entries: { cells: ['date', 'category', 'description', ['amount', money]], rowId: 'id', removeAs: 'remove_ids' },
  edit_entry: { cells: ['field', 'from', 'to'], rowId: 'field' },
}

export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LEAVE']

export function cellsFor(kind) {
  return (CARD_KINDS[kind] || { cells: [] }).cells.map((c) => (Array.isArray(c) ? { key: c[0], format: c[1] } : { key: c, format: (v) => v ?? '' }))
}

/** True when the card has any edit this screen supports. */
export function isEditable(kind) {
  const cfg = CARD_KINDS[kind]
  return Boolean(cfg && (cfg.removeAs || cfg.amount || cfg.status))
}

/**
 * Turn what the user changed in the edit form into the server's edit payload.
 * `draft` = { removed: Set(rowId), amounts: {rowId: value}, statuses: {rowId: status} }
 */
export function buildEdits(kind, rows, draft) {
  const cfg = CARD_KINDS[kind]
  const edits = {}
  if (!cfg) return edits
  if (cfg.removeAs && draft.removed.size) edits[cfg.removeAs] = [...draft.removed]
  if (cfg.amount) {
    const changed = {}
    rows.forEach((row) => {
      const id = row[cfg.amount.idKey]
      const value = draft.amounts[id]
      if (value !== undefined && value !== '' && Number(value) !== Number(row[cfg.amount.key]) && !draft.removed.has(id)) changed[id] = String(value)
    })
    if (Object.keys(changed).length) edits[cfg.amount.field] = changed
  }
  if (cfg.status) {
    const changed = {}
    rows.forEach((row) => {
      const id = row[cfg.rowId]
      if (draft.statuses[id] && draft.statuses[id] !== row[cfg.status.key]) changed[id] = draft.statuses[id]
    })
    if (Object.keys(changed).length) edits[cfg.status.field] = changed
  }
  return edits
}
