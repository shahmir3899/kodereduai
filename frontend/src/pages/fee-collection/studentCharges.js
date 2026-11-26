// Per-student fee amounts (overrides of the class charge) for one or several fee categories at once.
// Pure logic for StudentChargesGrid; mobile has the same rules in mobile/services/studentFees.ts.
// Every override names its category, monthly too: an uncategorised monthly override used to replace
// all of the student's monthly overrides and was then charged on every monthly fee (2026-11-26).

const amountText = (v) => (v == null || v === '' ? '' : String(Number(v)))
const categoryOf = (s, feeType) => (feeType === 'MONTHLY' ? s.monthly_category : s.annual_category) ?? null
const isEnrolledOnly = (c) => c.billing_mode === 'ENROLLED'
// The server's fallback for an uncategorised monthly row skips enrolled-only fees (generation_planner).
const usesLegacy = (feeType, c) => feeType === 'MONTHLY' && !isEnrolledOnly(c)
const live = (s, feeType) => s.is_active !== false && s.fee_type === feeType
const newestFirst = (a, b) => String(b.effective_from || '').localeCompare(String(a.effective_from || ''))

export const categoryKey = (feeType) => (feeType === 'ANNUAL' ? 'annual_category' : 'monthly_category')

// The class charge a student pays for one category unless they have their own amount.
export function classDefaultAmount(structures, classId, feeType, category) {
  const classRows = structures
    .filter((s) => !s.student && String(s.class_obj) === String(classId) && live(s, feeType))
    .sort(newestFirst)
  const hit = classRows.find((s) => String(categoryOf(s, feeType)) === String(category.id))
    ?? (usesLegacy(feeType, category) ? classRows.find((s) => categoryOf(s, feeType) == null) : undefined)
  if (hit) return amountText(hit.monthly_amount)
  return isEnrolledOnly(category) ? amountText(category.default_amount) : ''
}

// Student overrides of one category: student id -> { amount, legacy }. `legacy` marks an old override
// saved without a category, which still applies to every monthly fee that is not enrolled-only.
export function overrideAmounts(structures, feeType, category) {
  const out = {}
  const rows = structures.filter((s) => s.student && live(s, feeType)).sort(newestFirst)
  for (const s of rows) {
    if (String(categoryOf(s, feeType)) !== String(category.id)) continue
    if (out[s.student] === undefined) out[s.student] = { amount: amountText(s.monthly_amount), legacy: false }
  }
  if (usesLegacy(feeType, category)) {
    for (const s of rows) {
      if (categoryOf(s, feeType) != null) continue
      if (out[s.student] === undefined) out[s.student] = { amount: amountText(s.monthly_amount), legacy: true }
    }
  }
  return out
}

const rollOf = (s) => parseInt(String(s.roll_number ?? ''), 10) || 9999

// edits: category id -> student id -> typed text.
export function buildStudentRows(students, structures, classId, feeType, categories, edits) {
  const perCategory = categories.map((c) => ({
    c,
    classDefault: classDefaultAmount(structures, classId, feeType, c),
    overrides: overrideAmounts(structures, feeType, c),
    edits: edits[c.id] || {},
  }))
  return [...students]
    .sort((a, b) => rollOf(a) - rollOf(b) || String(a.name).localeCompare(String(b.name)))
    .map((s) => {
      const cells = {}
      for (const p of perCategory) {
        const own = p.overrides[s.id]
        const original = own?.amount ?? p.classDefault
        const edited = p.edits[s.id] !== undefined
        cells[p.c.id] = { amount: edited ? p.edits[s.id] : original, original, classDefault: p.classDefault, legacy: !!own?.legacy, edited }
      }
      return { studentId: s.id, name: s.name, roll: s.roll_number ? String(s.roll_number) : '', cells }
    })
}

// Only boxes that were edited and now hold a different, non-empty amount are sent, so a save never
// touches the rest of the class.
export function changedCells(rows) {
  const out = []
  for (const r of rows) {
    for (const [id, cell] of Object.entries(r.cells)) {
      const amount = String(cell.amount).trim()
      // An old uncategorised amount is saved even when kept as is: that moves it onto this fee.
      if (cell.edited && amount !== '' && (amount !== cell.original || cell.legacy)) {
        out.push({ studentId: r.studentId, name: r.name, roll: r.roll, categoryId: Number(id), amount, original: cell.original })
      }
    }
  }
  return out
}

export const isOverride = (cell) => String(cell.amount).trim() !== '' && String(cell.amount).trim() !== cell.classDefault

export const rowTotal = (r) =>
  Object.values(r.cells).reduce((sum, c) => sum + (Number.isFinite(Number(c.amount)) ? Number(c.amount) : 0), 0)

export function validateStudentCharges(rows, effectiveFrom, categoryIds) {
  if (categoryIds.length === 0) return 'Choose at least one fee.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom || '')) return 'Choose the date the new amounts start from.'
  const changed = changedCells(rows)
  if (changed.length === 0) return 'Change at least one student amount before saving.'
  const bad = [...new Set(changed.filter((c) => !Number.isFinite(Number(c.amount)) || Number(c.amount) < 0).map((c) => c.name))]
  if (bad.length) return `Enter a valid amount for ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ' and others' : ''}.`
  return null
}

export function buildStudentChargesPayload(classId, feeType, effectiveFrom, rows) {
  const key = categoryKey(feeType)
  return {
    class_id: Number(classId),
    fee_type: feeType,
    effective_from: effectiveFrom,
    students: changedCells(rows).map((c) => ({ student_id: c.studentId, monthly_amount: c.amount, [key]: c.categoryId })),
  }
}

// [{ category, count }] in the order the categories are shown, only those with changes.
export function changeCounts(changes, categories) {
  return categories
    .map((c) => ({ category: c, count: changes.filter((x) => x.categoryId === c.id).length }))
    .filter((x) => x.count > 0)
}
