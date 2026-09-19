import { shortExamName } from './reportCardData'

const dash = '—'

function GradePill({ value }) {
  return value
    ? <span className="px-1.5 py-0.5 bg-primary-100 text-primary-700 rounded text-xs font-medium">{value}</span>
    : dash
}

function PassText({ pass }) {
  if (pass === true) return <span className="text-green-600 text-xs font-medium">Pass</span>
  if (pass === false) return <span className="text-red-600 text-xs font-medium">Fail</span>
  return dash
}

/**
 * On-screen twin of the PDF's marks table. One exam: today's table. Several: one narrow
 * column per exam (earlier ones muted, the main/newest bold), then the result columns,
 * which come from the main exam - or the weighted blend when weighting is on.
 */
export default function MarksTable({ report }) {
  const subjects = report.subjects || []
  if (!subjects.length) {
    return <p className="text-center text-gray-500 text-sm py-4">No subject marks available.</p>
  }

  const exams = report.exams || []
  const multi = exams.length > 1
  const summary = report.summary
  const pct = (v) => (v != null ? `${Number(v).toFixed(1)}%` : dash)
  const avg = (v) => (v == null ? dash : (report.class_avg_unit === 'percent' ? `${v}%` : v))

  if (!multi) {
    return (
      <div className="overflow-x-auto mb-4">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
              <th className="px-3 py-2 text-center">Subject</th>
              <th className="px-3 py-2 text-center">Total</th>
              <th className="px-3 py-2 text-center">Obtained</th>
              <th className="px-3 py-2 text-center">%</th>
              <th className="px-3 py-2 text-center">Grade</th>
              <th className="px-3 py-2 text-center">Class Avg</th>
              <th className="px-3 py-2 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {subjects.map(s => (
              <tr key={s.subject_id} className={s.is_pass === false ? 'bg-red-50/30' : ''}>
                <td className="px-3 py-2 font-medium text-gray-900">{s.subject_name}</td>
                <td className="px-3 py-2 text-center text-gray-600">{s.total_marks}</td>
                <td className="px-3 py-2 text-center font-medium">
                  {s.is_absent ? <span className="text-red-500">Absent</span> : s.marks_obtained ?? dash}
                </td>
                <td className="px-3 py-2 text-center">{pct(s.percentage)}</td>
                <td className="px-3 py-2 text-center"><GradePill value={s.grade} /></td>
                <td className="px-3 py-2 text-center text-gray-600">{avg(s.class_avg)}</td>
                <td className="px-3 py-2 text-center"><PassText pass={s.is_pass} /></td>
              </tr>
            ))}
          </tbody>
          {summary && (
            <tfoot>
              <tr className="bg-gray-50 font-medium">
                <td className="px-3 py-2 text-center">Total</td>
                <td className="px-3 py-2 text-center">{summary.total_marks}</td>
                <td className="px-3 py-2 text-center">{summary.obtained_marks}</td>
                <td className="px-3 py-2 text-center">{pct(summary.percentage)}</td>
                <td className="px-3 py-2 text-center"><GradePill value={summary.grade} /></td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-center"><PassText pass={summary.overall_pass} /></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    )
  }

  const cell = (exam, subject) => {
    const m = exam.marks?.[subject.subject_id]
    if (!m) return dash
    if (m.is_absent) return 'Abs'
    return `${m.marks_obtained ?? dash}/${m.total_marks}`
  }
  const examTotal = (exam) => {
    let got = 0
    let of = 0
    subjects.forEach(s => {
      const m = exam.marks?.[s.subject_id]
      if (!m) return
      of += Number(m.total_marks) || 0
      if (!m.is_absent && m.marks_obtained != null) got += Number(m.marks_obtained)
    })
    return of ? `${got}/${of}` : dash
  }

  return (
    <div className="overflow-x-auto mb-4">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-xs text-gray-500 uppercase align-bottom">
            <th className="px-2 py-2 text-center">Subject</th>
            {exams.map(e => (
              <th key={e.exam_id} className={`px-2 py-2 text-center ${e.is_main ? 'text-gray-900' : ''}`}>
                {shortExamName(e.exam_name)}
                {report.weighted && <span className="block normal-case font-normal">{e.weight}%</span>}
              </th>
            ))}
            <th className="px-2 py-2 text-center">{report.weighted ? 'Result %' : '%'}</th>
            <th className="px-2 py-2 text-center">Grade</th>
            <th className="px-2 py-2 text-center">Class Avg</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {subjects.map(s => (
            <tr key={s.subject_id}>
              <td className="px-2 py-2 font-medium text-gray-900">{s.subject_name}</td>
              {exams.map(e => (
                <td key={e.exam_id} className={`px-2 py-2 text-center ${e.is_main ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>
                  {cell(e, s)}
                </td>
              ))}
              <td className={`px-2 py-2 text-center ${s.is_pass === false ? 'text-red-600' : ''}`}>{pct(s.percentage)}</td>
              <td className="px-2 py-2 text-center"><GradePill value={s.grade} /></td>
              <td className="px-2 py-2 text-center text-gray-600">{avg(s.class_avg)}</td>
            </tr>
          ))}
        </tbody>
        {summary && (
          <tfoot>
            <tr className="bg-gray-50 font-medium">
              <td className="px-2 py-2 text-center">Total</td>
              {exams.map(e => (
                <td key={e.exam_id} className={`px-2 py-2 text-center ${e.is_main ? '' : 'text-gray-400'}`}>{examTotal(e)}</td>
              ))}
              <td className="px-2 py-2 text-center">{pct(summary.percentage)}</td>
              <td className="px-2 py-2 text-center"><GradePill value={summary.grade} /></td>
              <td className="px-2 py-2" />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
