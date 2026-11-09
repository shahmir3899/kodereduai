// Pure helpers for the lesson plans page: date presets, stats, grouping and the readable lesson body.
// Mirrored in mobile/services/lessonPlanView.ts — keep the two in step.
import { normalizeLessonPlanText } from './lessonPlanTextUtils'

export const DATE_PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'next_month', label: 'Next month' },
]

const pad = (n) => String(n).padStart(2, '0')
export const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// Local-time ranges (a school day is local, so UTC would shift the edges). Weeks run Monday to Sunday.
export function presetRange(preset, today = new Date()) {
  const y = today.getFullYear()
  const m = today.getMonth()
  if (preset === 'today') return { from: isoDay(today), to: isoDay(today) }
  if (preset === 'week') {
    const back = (today.getDay() + 6) % 7
    const mon = new Date(y, m, today.getDate() - back)
    const sun = new Date(y, m, today.getDate() - back + 6)
    return { from: isoDay(mon), to: isoDay(sun) }
  }
  const shift = preset === 'last_month' ? -1 : preset === 'next_month' ? 1 : 0
  if (preset === 'month' || shift !== 0) {
    return { from: isoDay(new Date(y, m + shift, 1)), to: isoDay(new Date(y, m + shift + 1, 0)) }
  }
  return null
}

// Which preset the current range equals, so its chip can be highlighted; null means a custom range.
export function activePreset(from, to, today = new Date()) {
  return DATE_PRESETS.find((p) => {
    const r = presetRange(p.id, today)
    return r && r.from === from && r.to === to
  })?.id ?? null
}

export function planStats(plans) {
  const teachers = new Set()
  const subjects = new Set()
  const classes = new Set()
  let published = 0
  for (const p of plans) {
    if (p.status === 'PUBLISHED') published += 1
    if (p.teacher != null) teachers.add(p.teacher)
    if (p.subject != null) subjects.add(p.subject)
    classes.add(p.session_class ?? p.class_obj)
  }
  return {
    total: plans.length,
    published,
    draft: plans.length - published,
    teachers: teachers.size,
    subjects: subjects.size,
    classes: classes.size,
  }
}

const byLabel = (a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true })
const byDate = (a, b) => String(a.lesson_date).localeCompare(String(b.lesson_date)) || a.id - b.id

const tally = (plans) => {
  const published = plans.filter((p) => p.status === 'PUBLISHED').length
  return { count: plans.length, published, draft: plans.length - published }
}

// mode 'subject' -> Subject > Class > plans;  mode 'class' -> Class > Subject > plans.
export function groupPlans(plans, mode = 'subject') {
  const subjectOf = (p) => ({ key: `s${p.subject}`, label: p.subject_name || 'No subject' })
  const classOf = (p) => ({ key: `c${p.session_class ?? p.class_obj}`, label: p.class_name || 'No class' })
  const [outerOf, innerOf] = mode === 'class' ? [classOf, subjectOf] : [subjectOf, classOf]

  const outer = new Map()
  for (const p of plans) {
    const o = outerOf(p)
    const i = innerOf(p)
    if (!outer.has(o.key)) outer.set(o.key, { ...o, inner: new Map() })
    const og = outer.get(o.key)
    if (!og.inner.has(i.key)) og.inner.set(i.key, { ...i, plans: [] })
    og.inner.get(i.key).plans.push(p)
  }
  return [...outer.values()]
    .map((o) => {
      const children = [...o.inner.values()]
        .map((c) => ({ ...c, plans: c.plans.sort(byDate), ...tally(c.plans) }))
        .sort(byLabel)
      return {
        key: o.key,
        label: o.label,
        children,
        ...tally(children.flatMap((c) => c.plans)),
      }
    })
    .sort(byLabel)
}

// The lesson itself, in reading order. display_text is the server's rendering of topics/free text;
// description is the older free-text field, so it is a fallback rather than shown twice.
export function planBodySections(plan) {
  const topics = [
    ...(plan.planned_topics || []).map((t) => (typeof t === 'object' ? t.title || t.name : null)),
    ...(plan.custom_topics || []),
  ].filter(Boolean)
  const sections = [
    ['Lesson', normalizeLessonPlanText(plan.display_text) || normalizeLessonPlanText(plan.description)],
    ['Topics', topics.join('\n')],
    ['Objectives', normalizeLessonPlanText(plan.objectives_text ?? plan.objectives)],
    ['Materials', normalizeLessonPlanText(plan.materials_needed)],
    ['Teaching methods', normalizeLessonPlanText(plan.teaching_methods)],
  ]
  return sections.filter(([, text]) => text)
}
