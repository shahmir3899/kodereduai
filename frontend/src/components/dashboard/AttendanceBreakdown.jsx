// Single home for the student-attendance bar + legend so every dashboard shows all four
// states. LEAVE is a marked state; folding it into "not marked" made the dashboard report
// students as unmarked while the register showed everyone marked.
const SEGMENTS = [
  { key: 'present_count', label: 'Present', bar: 'bg-green-500' },
  { key: 'leave_count', label: 'On Leave', bar: 'bg-amber-400' },
  { key: 'absent_count', label: 'Absent', bar: 'bg-red-400' },
  { key: 'not_marked_count', label: 'Not marked', bar: 'bg-gray-400' },
]

export default function AttendanceBreakdown({ report }) {
  const total = report?.total_students || 0
  // `?? 0` keeps a payload cached before this field existed from rendering NaN.
  const value = (key) => report?.[key] ?? 0

  return (
    <>
      <div className="flex items-center gap-3 mb-2">
        <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden flex">
          {total > 0 && SEGMENTS.filter((s) => s.key !== 'not_marked_count').map((s) => (
            <div
              key={s.key}
              className={`${s.bar} h-full transition-all duration-500`}
              style={{ width: `${(value(s.key) / total) * 100}%` }}
            />
          ))}
        </div>
        <span className="text-xs text-gray-500 shrink-0 tabular-nums">{value('present_count')}/{total}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {SEGMENTS.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${s.bar}`} />
            {s.label}: {value(s.key)}
          </span>
        ))}
      </div>
    </>
  )
}
