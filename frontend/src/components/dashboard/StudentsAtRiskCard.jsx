import { Link } from 'react-router-dom'
import { TONE } from '../ui/statusTones'
import SectionCard from './SectionCard'

const SEVERITY = {
  HIGH: TONE.danger,
  MEDIUM: TONE.warning,
  LOW: TONE.sky,
}

function Group({ title, block, metric }) {
  const students = block?.students || []
  if (!students.length) return null
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
        {title} <span className="text-gray-400 normal-case font-normal">· {block.at_risk_count} at risk</span>
      </p>
      <div className="space-y-2">
        {students.map((s) => (
          <Link
            key={s.student_id}
            to={`/students/${s.student_id}`}
            className="block rounded-lg border border-gray-100 px-3 py-2 hover:bg-gray-50"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-gray-800 truncate">
                {s.student_name}
                {s.class_name && <span className="ml-1.5 text-xs font-normal text-gray-500">{s.class_name}</span>}
              </p>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${SEVERITY[s.severity] || SEVERITY.LOW}`}>
                {s.severity}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{metric(s)}</p>
            {s.suggested_action && <p className="text-xs text-gray-700 mt-1">{s.suggested_action}</p>}
          </Link>
        ))}
      </div>
    </div>
  )
}

/**
 * Teacher-scoped "students needing attention" card. `data` is the response of
 * academicsApi.getMyStudentsAtRisk — already limited to the teacher's own sections.
 */
export default function StudentsAtRiskCard({ data, loading, error }) {
  const attendance = data?.attendance
  const academic = data?.academic
  const nothing = !(attendance?.students?.length) && !(academic?.students?.length)

  return (
    <SectionCard
      id="students-at-risk"
      title="Students Needing Attention"
      loading={loading}
      error={error}
      empty={nothing}
      emptyText="No students in your sections are flagged at risk."
    >
      <div className="space-y-4">
        <Group
          title="Attendance"
          block={attendance}
          metric={(s) => `${s.current_rate}% attendance${s.consecutive_absent_days > 0 ? ` · ${s.consecutive_absent_days} day${s.consecutive_absent_days === 1 ? '' : 's'} absent in a row` : ''}`}
        />
        <Group
          title="Marks"
          block={academic}
          metric={(s) => `${s.current_average}% average${s.consecutive_fails > 0 ? ` · failed ${s.consecutive_fails} exam(s) in a row` : ''}`}
        />
      </div>
    </SectionCard>
  )
}
