export function extractNumericRolls(rollValues = []) {
  const unique = new Set()

  rollValues.forEach((value) => {
    const normalized = String(value ?? '').trim()
    if (!normalized) return

    if (!/^\d+$/.test(normalized)) return

    const parsed = parseInt(normalized, 10)
    if (parsed > 0) unique.add(parsed)
  })

  return Array.from(unique).sort((a, b) => a - b)
}

export function getNextAvailableRoll(rollValues = [], startAt = 1) {
  const used = new Set(extractNumericRolls(rollValues).filter((n) => n >= startAt))

  let candidate = startAt
  while (used.has(candidate)) {
    candidate += 1
  }

  return String(candidate)
}
