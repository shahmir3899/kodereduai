import { useQuery } from '@tanstack/react-query'
import { useAcademicYear } from '../contexts/AcademicYearContext'
import { sessionsApi } from '../services/api'

function MiniStat({ label, value, color }) {
  return (
    <div className={`rounded-lg p-3 ${color}`}>
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="text-xl font-bold mt-0.5">{value}%</p>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="card animate-pulse">
      <div className="h-5 bg-gray-200 rounded w-48 mb-4" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-16 bg-gray-100 rounded-lg" />
        ))}
      </div>
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-3 bg-gray-100 rounded w-full" />
        ))}
      </div>
    </div>
  )
}

export default function SessionHealthWidget() {
  const { activeAcademicYear, hasAcademicYear } = useAcademicYear()

  const { data, isLoading } = useQuery({
    queryKey: ['sessionHealth', activeAcademicYear?.id],
    queryFn: () => sessionsApi.getSessionHealth({ academic_year: activeAcademicYear?.id }),
    enabled: !!activeAcademicYear?.id,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  if (!hasAcademicYear) return null

  if (isLoading) return <SkeletonCard />

  const report = data?.data
  if (!report || !report.success) return null

  const summary = report.ai_summary

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">
          Session Health: {report.academic_year?.name}
        </h2>
        {summary?.source === 'ai' && (
          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
            AI Summary
          </span>
        )}
      </div>

      {/* Mini stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <MiniStat
          label="Enrollment"
          value={report.enrollment?.enrollment_rate ?? 0}
          color="bg-blue-50 text-blue-800"
        />
        <MiniStat
          label="Attendance"
          value={report.attendance?.average_attendance_rate ?? 0}
          color="bg-green-50 text-green-800"
        />
        <MiniStat
          label="Fee Collection"
          value={report.fee_collection?.collection_rate ?? 0}
          color="bg-orange-50 text-orange-800"
        />
        <MiniStat
          label="Pass Rate"
          value={report.exam_performance?.average_pass_rate ?? 0}
          color="bg-purple-50 text-purple-800"
        />
      </div>

      {/* AI Summary Bullets */}
      {summary && (
        <div className="space-y-3">
          {summary.highlights?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Highlights</p>
              <ul className="space-y-1">
                {summary.highlights.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.concerns?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Concerns</p>
              <ul className="space-y-1">
                {summary.concerns.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.action_items?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Action Items</p>
              <ul className="space-y-1">
                {summary.action_items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
