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

/**
 * Derive a lesson title from LessonPlanTopicsPickerModal's `curriculumSummary`
 * (lines like "• Book › Chapter: Topic" or "• Book › Chapter › Topic: Sub-topic"),
 * plus any teacher-typed custom topics on their own line below. Used by
 * minimal-mode lesson plan creation, where the user never types a title —
 * this derived title is what shows in the compact PDF export's "Lesson /
 * Topic" column, so custom-only rows need it too or they'd read as blank.
 */
export function deriveAutoTitleFromCurriculumSummary(curriculumSummary, customTopics = [], fallback = 'Lesson') {
  const lines = String(curriculumSummary || '')
    .split('\n')
    .map((line) => line.replace(/^[•\-*]\s*/, '').trim())
    .filter(Boolean)
  const names = lines
    .map((line) => {
      const afterColon = line.includes(':') ? line.split(':').pop() : line
      const afterArrow = afterColon.includes('›') ? afterColon.split('›').pop() : afterColon
      return afterArrow.trim()
    })
    .filter(Boolean)
  const unique = Array.from(new Set(names))
  const bookTitle = unique.slice(0, 3).join(', ')

  const customTitle = (customTopics || [])
    .map((label) => String(label || '').trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(', ')

  const combined = [bookTitle, customTitle].filter(Boolean).join('\n')
  return (combined || fallback).slice(0, 200)
}
