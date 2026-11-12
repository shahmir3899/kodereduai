// Shared by the student and parent fee pages. Both read students.history.fee_rows: a plain list
// of rows from every branch the child has studied at, each tagged `branch` (null = current branch,
// otherwise the earlier branch's name), plus `handed_over` / `carried` for a transfer.

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const num = (v) => parseFloat(v || 0)

// The endpoint sends month as a number and no month name, so build the label here.
export function feeLabel(p) {
  if (p.fee_type === 'MONTHLY') return MONTH_NAMES[p.month - 1] || '-'
  return p.annual_category_name || p.fee_type_display || '-'
}

const byPeriod = (a, b) => (a.year - b.year) || (a.month - b.month)

// Monthly rows are cumulative (amount_due = previous_balance + that month's fee), so summing
// amount_due would count a carried balance again in every later month. Charged is therefore
// due minus carried-in; the balance is the latest month's own running balance.
// Annual rows each carry their own balance, so they simply add up.
// A row whose balance was handed over to the child's new branch is owed there, not here, so it
// adds nothing to the balance (the money is only shown once, at the branch that now owes it).
export function feeTotals(rows, tab) {
  const paid = rows.reduce((s, p) => s + num(p.amount_paid), 0)
  const remaining = (p) => (p.handed_over ? 0 : num(p.amount_due) - num(p.amount_paid))
  if (tab === 'MONTHLY') {
    const latest = rows.slice().sort(byPeriod).at(-1)
    return {
      charged: rows.reduce((s, p) => s + num(p.amount_due) - num(p.previous_balance), 0),
      paid,
      balance: latest ? remaining(latest) : 0,
    }
  }
  return {
    charged: rows.reduce((s, p) => s + num(p.amount_due), 0),
    paid,
    balance: rows.reduce((s, p) => s + remaining(p), 0),
  }
}

// One entry per branch, current branch first. The current branch's rows are limited to the active
// academic year; an earlier branch's years belong to another school, so all its rows are kept.
export function groupByBranch(rows, activeYearId) {
  const groups = [{ key: null, name: null, rows: [] }]
  for (const p of rows) {
    if (!p.branch) {
      if (p.academic_year === activeYearId) groups[0].rows.push(p)
      continue
    }
    let g = groups.find((x) => x.key === p.branch)
    if (!g) {
      g = { key: p.branch, name: p.branch, rows: [] }
      groups.push(g)
    }
    g.rows.push(p)
  }
  return groups
}

export function sortFeeRows(rows, tab) {
  return tab === 'MONTHLY' ? rows.slice().sort(byPeriod) : rows.slice()
}
