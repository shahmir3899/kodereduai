import { useState } from 'react'
import { Link } from 'react-router-dom'

const MONTH_TABS = [
  ['previous_month', 'Previous'],
  ['current_month', 'Current'],
  ['next_month', 'Next'],
]

// "2026-11" -> the first and last day, for the lesson plans page link.
function monthRange(label) {
  const m = /^(\d{4})-(\d{2})$/.exec(label || '')
  if (!m) return null
  const last = new Date(Number(m[1]), Number(m[2]), 0).getDate()
  return { from: `${label}-01`, to: `${label}-${String(last).padStart(2, '0')}` }
}

// Teachers whose plan count this month is below last month's, or who still have drafts waiting.
// A teacher teaches in several classes, so rows are added up across the class tree. Biggest drop first.
function teachersBehind(byClass, limit = 5) {
  const byTeacher = new Map()
  for (const c of byClass) {
    for (const t of c.teachers) {
      const row = byTeacher.get(t.teacher_id) || { teacher_id: t.teacher_id, teacher_name: t.teacher_name, current: 0, previous: 0, drafts: 0 }
      row.current += t.current_month
      row.previous += t.previous_month
      row.drafts += t.draft_current_month
      byTeacher.set(t.teacher_id, row)
    }
  }
  return [...byTeacher.values()]
    .filter((r) => r.current < r.previous || r.drafts > 0)
    .sort((a, b) => (b.previous - b.current) - (a.previous - a.current) || b.drafts - a.drafts || a.teacher_name.localeCompare(b.teacher_name))
    .slice(0, limit)
}

function TeachersBehind({ byClass, buckets }) {
  const rows = teachersBehind(byClass)
  if (rows.length === 0) return null
  const range = monthRange(buckets.current_month?.label)
  return (
    <div>
      <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1.5">Teachers behind schedule</p>
      <div className="border border-gray-100 rounded-lg divide-y divide-gray-100 text-xs">
        {rows.map((t) => (
          <div key={t.teacher_id} className="flex justify-between gap-2 px-2 py-1.5">
            <Link
              to={`/academics/lesson-plans?teacher_id=${t.teacher_id}${range ? `&from=${range.from}&to=${range.to}` : ''}`}
              className="text-sky-700 hover:underline truncate"
            >
              {t.teacher_name}
            </Link>
            <span className="text-gray-600 tabular-nums shrink-0">
              {t.current} this month ({t.previous} last)
              {t.drafts > 0 && <span className="text-amber-700"> · {t.drafts} draft{t.drafts === 1 ? '' : 's'}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Class > teacher > subjects with plan counts for one month. A subject with no plans in the chosen
// month still shows (as 0) when it has plans in a neighbouring month, so gaps are visible.
function LessonPlansByClass({ byClass, buckets }) {
  const [month, setMonth] = useState('current_month')
  const range = monthRange(buckets[month]?.label)
  const link = (teacherId, subjectId) => {
    const q = new URLSearchParams()
    if (teacherId) q.set('teacher_id', teacherId)
    if (subjectId) q.set('subject_id', subjectId)
    if (range) { q.set('from', range.from); q.set('to', range.to) }
    return `/academics/lesson-plans?${q.toString()}`
  }
  const rows = byClass.filter((c) => c[month] > 0 || c.teachers.some((t) => t.subjects.some((s) => s[month] === 0)))
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[10px] font-semibold text-gray-500 uppercase">Lesson plans by class</p>
        <div className="inline-flex rounded-md border border-gray-200 overflow-hidden">
          {MONTH_TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMonth(key)}
              title={buckets[key]?.label}
              className={`px-2 py-0.5 text-[11px] ${month === key ? 'bg-sky-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-72 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-100 text-xs">
        {rows.length === 0 && <p className="px-2 py-2 text-gray-500">No lesson plans in {buckets[month]?.label || 'this month'}.</p>}
        {rows.map((c) => (
          <div key={c.class_id} className="px-2 py-1.5">
            <div className="flex justify-between font-medium text-gray-900">
              <span className="truncate">{c.class_name}</span>
              <span className="tabular-nums text-gray-600">{c[month]} plans</span>
            </div>
            {c.teachers.map((t) => (
              <div key={t.teacher_id} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5 pl-2">
                <Link to={link(t.teacher_id)} className="text-sky-700 hover:underline truncate max-w-[130px]">{t.teacher_name}</Link>
                <span className="text-gray-400">—</span>
                {t.subjects.map((sub) => (
                  <Link
                    key={sub.subject_id}
                    to={link(t.teacher_id, sub.subject_id)}
                    className={`px-1.5 py-0.5 rounded border ${
                      sub[month] === 0
                        ? 'bg-red-50 text-red-700 border-red-100'
                        : 'bg-gray-50 text-gray-700 border-gray-100 hover:bg-gray-100'
                    }`}
                  >
                    {sub.subject_name} ({sub[month]})
                  </Link>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Leadership insights (bootstrap leadership-academic-insights) ─────────────

export default function LeadershipInsightsPanels({ data, loading, showRoster, showCurriculum }) {
  if (!showRoster && !showCurriculum) return null

  if (loading) {
    return (
      <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card min-h-[160px] animate-pulse bg-gray-50" />
        <div className="card min-h-[160px] animate-pulse bg-gray-50" />
      </div>
    )
  }

  if (!data) return null

  const admits = data.admissions || {}
  const deps = data.departures || {}
  const books = data.lms_books_by_class || []
  const topicsByBook = data.lms_topics_by_book || []
  const qb = data.question_bank || { total: 0, by_subject: [] }
  const lp = data.lesson_plans || { buckets: {}, by_teacher_class: [] }
  const lpByClass = lp.by_class || []
  const buckets = lp.buckets || {}

  const depChip = (label, block) => {
    if (!block) return null
    const st = block.by_status || {}
    return (
      <div className="text-left rounded-lg bg-gray-50 px-3 py-2 border border-gray-100">
        <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">{label}</p>
        <p className="text-lg font-semibold text-gray-900 tabular-nums">{block.total ?? 0}</p>
        <div className="flex flex-wrap gap-1 mt-1">
          {Object.entries(st).filter(([, n]) => n > 0).map(([k, n]) => (
            <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-600">
              {k.replace(/_/g, ' ')} {n}
            </span>
          ))}
        </div>
      </div>
    )
  }

  const topicPreview = topicsByBook.slice(0, 12)

  return (
    <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
      {showRoster && (
        <div className="card">
          <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
            <h2 className="text-sm font-semibold text-gray-900">Admissions & departures</h2>
            <div className="flex gap-3 text-xs shrink-0">
              <Link to="/students" className="text-sky-600 hover:text-sky-700 font-medium">Students</Link>
              <Link to="/admissions" className="text-sky-600 hover:text-sky-700 font-medium">Admissions</Link>
            </div>
          </div>
          <p className="text-[11px] text-gray-500 mb-3">
            New students use <span className="font-medium">record created</span> date. Departures use{' '}
            <span className="font-medium">enrollment</span> status (withdrawn / transferred / graduated).
          </p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="rounded-lg bg-sky-50 border border-sky-100 p-3 text-center">
              <p className="text-[10px] text-sky-700 font-medium uppercase">Session (enrolled)</p>
              <p className="text-2xl font-bold text-sky-900 tabular-nums">
                {admits.session != null ? admits.session.count : '—'}
              </p>
            </div>
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3 text-center">
              <p className="text-[10px] text-emerald-700 font-medium uppercase">Last 90 days</p>
              <p className="text-2xl font-bold text-emerald-900 tabular-nums">{admits.rolling_90d?.count ?? 0}</p>
            </div>
            <div className="rounded-lg bg-white border border-gray-200 p-3 text-center">
              <p className="text-[10px] text-gray-500 font-medium uppercase">Last 30 days</p>
              <p className="text-xl font-semibold text-gray-900 tabular-nums">{admits.rolling_30d?.count ?? 0}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {depChip('Departures 30d', deps.rolling_30d)}
            {depChip('Departures 90d', deps.rolling_90d)}
            {deps.session ? depChip('Departures (session)', deps.session) : (
              <div className="rounded-lg bg-gray-50 px-3 py-2 border border-gray-100 text-[11px] text-gray-500 flex items-center">
                Set current academic year for session-scoped departures.
              </div>
            )}
          </div>
        </div>
      )}
      {showCurriculum && (
        <div className="card space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-semibold text-gray-900">Curriculum & plans</h2>
            <Link to="/academics/lesson-plans" className="text-xs text-sky-600 hover:text-sky-700 font-medium">
              Lesson plans
            </Link>
          </div>

          {books.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1.5">LMS books by class</p>
              <div className="flex flex-wrap gap-2">
                {books.map((row) => (
                  <span
                    key={row.class_id}
                    className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-indigo-50 text-indigo-900 border border-indigo-100"
                  >
                    <span className="font-medium truncate max-w-[140px]">{row.class_name}</span>
                    <span className="tabular-nums text-indigo-700">{row.book_count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {topicPreview.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1.5">Topics per book (sample)</p>
              <div className="max-h-36 overflow-y-auto text-xs border border-gray-100 rounded-lg divide-y divide-gray-50">
                {topicPreview.map((row) => (
                  <div key={row.book_id} className="flex justify-between gap-2 px-2 py-1.5 hover:bg-gray-50">
                    <span className="text-gray-700 truncate" title={row.book_title}>
                      {row.class_name ? `${row.class_name} · ` : ''}{row.book_title}
                    </span>
                    <span className="text-gray-500 tabular-nums shrink-0">{row.topic_count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {qb.total > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Question bank</p>
              <p className="text-lg font-semibold text-gray-900">{qb.total} questions</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {(qb.by_subject || []).slice(0, 6).map((s) => (
                  <span key={s.subject_id} className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-800 border border-purple-100">
                    {s.subject_name}: {s.count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {lpByClass.length > 0 ? (
            <LessonPlansByClass byClass={lpByClass} buckets={buckets} />
          ) : null}

          {lpByClass.length > 0 && <TeachersBehind byClass={lpByClass} buckets={buckets} />}

          {books.length === 0 && topicPreview.length === 0 && qb.total === 0 && lpByClass.length === 0 && (
            <p className="text-xs text-gray-500">No curriculum or question bank data yet for this school.</p>
          )}
        </div>
      )}
    </div>
  )
}
