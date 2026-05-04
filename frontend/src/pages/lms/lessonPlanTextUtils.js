/**
 * Coerce lesson-plan text fields to a trimmed string.
 * AI / APIs may return arrays (bullet lists) or objects instead of plain strings.
 */
export function normalizeLessonPlanText(val) {
  if (val == null || val === '') return ''
  if (typeof val === 'string') return val.trim()
  if (typeof val === 'number' || typeof val === 'boolean') return String(val).trim()
  if (Array.isArray(val)) {
    return val
      .map((x) => normalizeLessonPlanText(x))
      .filter((s) => s.length > 0)
      .join('\n')
      .trim()
  }
  if (typeof val === 'object') {
    const inner = val.text ?? val.content ?? val.description ?? val.body ?? val.title
    if (inner !== undefined && inner !== val) return normalizeLessonPlanText(inner)
    return ''
  }
  return String(val).trim()
}
