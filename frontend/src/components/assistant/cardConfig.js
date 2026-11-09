// How each kind of change card is drawn and edited. The server sends `preview.kind`, `columns` (labels)
// and `rows`; the row keys differ per kind, so the mapping lives here, next to the edit rules.

const money = (v) => (typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v ?? '')

export const CARD_KINDS = {
  fee_payments: {
    cells: ['student', 'class', 'period', 'due', ['paying', money]],
    rowId: 'id', removeAs: 'remove_ids', amount: { key: 'paying', field: 'amounts', idKey: 'id' },
    note: 'Account, method and date can be changed by asking Aura.',
  },
  expense_entries: { cells: ['date', 'category', 'description', ['amount', money]], rowId: 'key', removeAs: 'remove_keys', amount: { key: 'amount', field: 'amounts', idKey: 'key' } },
  income_entries: { cells: ['date', 'category', 'description', ['amount', money]], rowId: 'key', removeAs: 'remove_keys', amount: { key: 'amount', field: 'amounts', idKey: 'key' } },
  lesson_plans: { cells: ['date', 'weekday', 'section', 'content'], rowId: 'key', removeAs: 'remove_keys' },
  attendance: { cells: ['student', 'was', 'status'], rowId: 'student_id', status: { key: 'status', field: 'statuses' } },
  assignments: { cells: ['section', 'subject', 'type', 'text'], rowId: 'key', removeAs: 'remove_keys' },
  delete_lesson_plans: { cells: ['date', 'class', 'subject', 'title', 'status'], rowId: 'id', removeAs: 'remove_ids' },
  delete_entries: { cells: ['date', 'category', 'description', ['amount', money]], rowId: 'id', removeAs: 'remove_ids' },
  marks_entry: {
    cells: ['student', 'was', ['marks', (v, row) => (row?.absent ? 'Absent' : money(v))]],
    rowId: 'student_id', removeAs: 'remove_ids', amount: { key: 'marks', field: 'amounts', idKey: 'student_id' },
  },
  delete_marks: { cells: ['student', 'marks'], rowId: 'id', removeAs: 'remove_ids' },
  exam_create: { cells: ['field', 'value'], rowId: 'field' },
  exam_reschedule: { cells: ['what', 'from', 'to'], rowId: 'what' },
  delete_exams: { cells: ['exam', 'class', 'status'], rowId: 'id' },
  leave_decision: { cells: ['staff', 'type', 'from', 'to', 'days', 'decision'], rowId: 'id', removeAs: 'remove_ids' },
  payslips_generate: { cells: ['staff', ['basic', money], ['net', money]], rowId: 'staff' },
  payslip_batch: { cells: ['staff', 'period', ['net', money], 'from', 'to'], rowId: 'id', removeAs: 'remove_ids' },
  delete_payslips: { cells: ['staff', 'period', ['net', money], 'from', 'to'], rowId: 'id', removeAs: 'remove_ids' },
  preferences: { cells: ['field', 'value'], rowId: 'field' },
  grade_submissions: { cells: ['student', 'was', 'marks', 'feedback'], rowId: 'key', removeAs: 'remove_keys', amount: { key: 'marks', field: 'amounts', idKey: 'key' } },
  return_submissions: { cells: ['student', 'marks'], rowId: 'key', removeAs: 'remove_keys' },
  enquiry_form: { cells: ['field', 'value'], rowId: 'field' },
  enquiry_convert: { cells: ['field', 'value'], rowId: 'field' },
  reclassify: { cells: ['field', 'value'], rowId: 'field' },
  library_issue: { cells: ['field', 'value'], rowId: 'field' },
  library_return: { cells: ['book', 'borrower', 'due', 'days_late', ['fine', money]], rowId: 'id', removeAs: 'remove_ids' },
  gate_pass_decision: { cells: ['student', 'type', 'reason', 'leaves', 'back_by', 'decision'], rowId: 'id', removeAs: 'remove_ids' },
  stock_entries: {
    cells: ['item', 'type', 'quantity', 'before', 'after'], rowId: 'key', removeAs: 'remove_keys',
    amount: { key: 'quantity', field: 'amounts', idKey: 'key' },
  },
  parent_message: { cells: ['field', 'value'], rowId: 'field' },
  leave_apply: { cells: ['field', 'value'], rowId: 'field' },
  staff_attendance: {
    cells: ['staff', 'was', 'status'], rowId: 'staff_id', removeAs: 'remove_ids',
    status: { key: 'status', field: 'statuses', options: ['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'ON_LEAVE'] },
  },
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
