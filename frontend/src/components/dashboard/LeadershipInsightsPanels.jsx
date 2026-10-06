import { Link } from 'react-router-dom'

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
  const lpRows = lp.by_teacher_class || []
  const buckets = lp.buckets || {}
  const prevL = buckets.previous_month?.label || 'Prev'
  const curL = buckets.current_month?.label || 'Current'
  const nextL = buckets.next_month?.label || 'Next'

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
  const lpPreview = lpRows.slice(0, 18)

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

          {lpPreview.length > 0 && (
            <div className="overflow-x-auto border border-gray-100 rounded-lg">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-left text-[10px] uppercase text-gray-500">
                    <th className="px-2 py-2 font-medium">Teacher</th>
                    <th className="px-2 py-2 font-medium">Class</th>
                    <th className="px-2 py-2 font-medium tabular-nums">{prevL}</th>
                    <th className="px-2 py-2 font-medium tabular-nums">{curL}</th>
                    <th className="px-2 py-2 font-medium tabular-nums">{nextL}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lpPreview.map((row) => (
                    <tr key={`${row.teacher_id}-${row.class_id}`} className="hover:bg-gray-50/80">
                      <td className="px-2 py-1.5 text-gray-800 max-w-[120px] truncate">{row.teacher_name}</td>
                      <td className="px-2 py-1.5 text-gray-600 max-w-[80px] truncate">{row.class_name}</td>
                      <td className="px-2 py-1.5 tabular-nums text-gray-700">{row.previous_month}</td>
                      <td className="px-2 py-1.5 tabular-nums text-gray-700">{row.current_month}</td>
                      <td className="px-2 py-1.5 tabular-nums text-gray-700">{row.next_month}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {lpRows.length > lpPreview.length && (
                <p className="text-[10px] text-gray-500 px-2 py-1 border-t bg-gray-50">
                  Showing {lpPreview.length} of {lpRows.length} teacher–class combinations.
                </p>
              )}
            </div>
          )}

          {books.length === 0 && topicPreview.length === 0 && qb.total === 0 && lpPreview.length === 0 && (
            <p className="text-xs text-gray-500">No curriculum or question bank data yet for this school.</p>
          )}
        </div>
      )}
    </div>
  )
}
