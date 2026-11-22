// Shared bits for the teacher performance pages (admin list, detail, settings; Phase 3 dashboard card).

// Local calendar date, not toISOString(): in UTC+5 that serialises local midnight as the day before.
export function isoDate(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 'YYYY-MM' -> { start, end }, ending today for the current month (the server also stops at today). */
export function monthRange(month) {
  const [y, m] = month.split('-').map(Number)
  const start = new Date(y, m - 1, 1)
  const end = new Date(y, m, 0)
  return { start: isoDate(start), end: isoDate(end) }
}

export function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const BAND_TONE = { EXCELLENT: 'success', GOOD: 'info', FAIR: 'warning', NEEDS_ATTENTION: 'danger' }

export function bandTone(band) {
  return (band && BAND_TONE[band.key]) || 'neutral'
}

export function formatScore(score) {
  return score === null || score === undefined ? '—' : Number(score).toFixed(1)
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

// Display order of the ten measures (matches the plan and the server's scoring.MEASURE_LABELS).
export const MEASURE_ORDER = [
  'attendance_marking', 'lesson_plans', 'marks_entry', 'own_attendance', 'homework',
  'grading', 'messages_answered', 'question_papers', 'book_content', 'login_days',
]

export function orderedMeasures(measures) {
  return MEASURE_ORDER.map((k) => measures?.[k]).filter(Boolean)
}

/** Readable one-liner for a missed item from any measure. */
export function describeMissed(item) {
  const what = item.section || item.lesson || item.exam || item.assignment || item.class_subject || ''
  const who = item.student ? ` (${item.student})` : ''
  return [item.date, what && `${what}${who}`, item.reason].filter(Boolean).join(' · ')
}

/** Suggested 1-5 appraisal rating from a 0-100 score (plan section 7: score ÷ 20, rounded). */
export function suggestedRating(score) {
  if (score === null || score === undefined) return ''
  return Math.min(5, Math.max(1, Math.round(Number(score) / 20)))
}

/** Appraisal form values pre-filled from one teacher's report; the reviewer can change all of them. */
export function appraisalPrefill(teacher, period) {
  const wins = (teacher.quickest_wins || []).map((w) => `- ${w.label} (up to ${w.points_available} points)`)
  return {
    staff_member: teacher.staff_id,
    review_period_start: period.start,
    review_period_end: period.end,
    rating: suggestedRating(teacher.overall_score),
    areas_for_improvement: wins.length
      ? [`From the teacher performance report (${period.start} to ${period.end}, score ${teacher.overall_score}):`, ...wins].join('\n')
      : '',
  }
}

const INFO_LABEL = {
  questions_added: 'Questions added to the bank',
  leave_days: 'Approved leave (working days)',
}

/** The information-only figures as label/value rows. */
export function infoRows(info) {
  if (!info) return []
  const rows = []
  const s = info.syllabus_on_schedule
  if (s && s.planned) rows.push({ label: 'Syllabus topics taught on schedule', value: `${s.taught_on_time} of ${s.planned}` })
  if (info.class_result_average !== null && info.class_result_average !== undefined) {
    rows.push({ label: 'Class result average', value: `${info.class_result_average}% (${info.marks_counted} marks)` })
  }
  for (const key of ['questions_added', 'leave_days']) {
    if (info[key] !== undefined) rows.push({ label: INFO_LABEL[key], value: String(info[key]) })
  }
  return rows
}

