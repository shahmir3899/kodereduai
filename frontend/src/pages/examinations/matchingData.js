// Matching questions are edited as rows of text pairs ({left, right}) in the paper composer, but the server (and the
// mobile app, and the question bank) store them as two lists plus index pairs:
//   { left_items: ['Fish', 'Bird'], right_items: ['Water', 'Nest'], pairs: [{left: 0, right: 0}, {left: 1, right: 1}] }
// These two functions convert between the shapes. Items that have no partner (a distractor on the right, a left item
// left unmatched) ride along in extra_left / extra_right while editing, so saving never drops them.

const text = (v) => String(v ?? '').trim()

export function isCompletePair(pair) {
  return !!text(pair?.left) && !!text(pair?.right)
}

// Server shape -> composer shape. Anything that already is composer-shaped (or empty) is returned as it is.
export function matchingToComposer(typeData) {
  const td = typeData || {}
  if (!Array.isArray(td.left_items) || !Array.isArray(td.right_items)) return td
  const used = Array.isArray(td.pairs) ? td.pairs : []
  const usedLeft = new Set()
  const usedRight = new Set()
  const pairs = []
  used.forEach((p) => {
    const left = td.left_items[p?.left]
    const right = td.right_items[p?.right]
    if (left === undefined || right === undefined || usedLeft.has(p.left) || usedRight.has(p.right)) return
    usedLeft.add(p.left)
    usedRight.add(p.right)
    pairs.push({ left, right })
  })
  return {
    ...td,
    pairs,
    left_items: undefined,
    right_items: undefined,
    extra_left: td.left_items.filter((_, i) => !usedLeft.has(i)),
    extra_right: td.right_items.filter((_, i) => !usedRight.has(i)),
  }
}

// Composer shape -> the server's shape. Only complete pairs count; extras are kept after them.
export function matchingFromComposer(typeData) {
  const td = typeData || {}
  const complete = (td.pairs || []).filter(isCompletePair)
  const extraLeft = (td.extra_left || []).map(text).filter(Boolean)
  const extraRight = (td.extra_right || []).map(text).filter(Boolean)
  const { pairs: _p, extra_left: _l, extra_right: _r, left_items: _li, right_items: _ri, ...rest } = td
  return {
    ...rest,
    left_items: [...complete.map((p) => text(p.left)), ...extraLeft],
    right_items: [...complete.map((p) => text(p.right)), ...extraRight],
    pairs: complete.map((_, i) => ({ left: i, right: i })),
  }
}

// The same rule the server enforces: two or more complete pairs.
export const MATCHING_MIN_PAIRS = 2
export const matchingProblem = (typeData) => ((typeData?.pairs || []).filter(isCompletePair).length < MATCHING_MIN_PAIRS
  ? 'Add at least two complete pairs.'
  : null)
