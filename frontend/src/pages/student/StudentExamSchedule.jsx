import { useQuery } from '@tanstack/react-query'
import { studentPortalApi } from '../../services/api'

function formatTime(time) {
  if (!time) return ''
  const parts = time.split(':')
  if (parts.length < 2) return time
  const h = parseInt(parts[0])
  const m = parts[1]
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${m} ${ampm}`
}

export default function StudentExamSchedule() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['studentExamSchedule'],
    queryFn: () => studentPortalApi.getExamSchedule(),
  })

  const exams = data?.data || []

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <h3 className="text-base font-medium text-red-900 mb-1">Failed to load exam schedule</h3>
        <p className="text-sm text-red-600">{error.message || 'Please try again later.'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Exam Schedule</h1>
        <p className="text-sm text-gray-500 mt-1">Upcoming exam dates for your class</p>
      </div>

      {exams.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <svg className="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <h3 className="text-base font-medium text-gray-900 mb-1">No exam schedule published yet</h3>
          <p className="text-sm text-gray-500">Check back once your school announces the exam dates.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {exams.map(exam => (
            <div key={exam.exam_id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-1">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">{exam.exam_name}</h3>
                  <p className="text-xs text-gray-500">
                    {exam.exam_type}
                    {exam.start_date && ` · ${exam.start_date}${exam.end_date ? ` — ${exam.end_date}` : ''}`}
                  </p>
                </div>
              </div>
              {exam.subjects.length === 0 ? (
                <p className="px-4 py-3 text-sm text-gray-500">Subject dates not set yet.</p>
              ) : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <th className="px-4 py-2 text-left">Subject</th>
                      <th className="px-4 py-2 text-left">Date</th>
                      <th className="px-4 py-2 text-left">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {exam.subjects.map((s, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2 text-gray-800">{s.subject_name}</td>
                        <td className="px-4 py-2 text-gray-600">{s.exam_date || '—'}</td>
                        <td className="px-4 py-2 text-gray-500">
                          {s.start_time ? `${formatTime(s.start_time)} - ${formatTime(s.end_time)}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
