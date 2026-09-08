import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { examinationsApi } from '../../services/api'

// Exams list is already teacher-scoped server-side (get_teacher_combined_scope
// via _apply_teacher_exam_scope in ExamViewSet.get_queryset) to every class the
// teacher teaches any subject in -- not just their assigned class-teacher class.
// Exam subjects share that same scoping, so no client-side class filtering is
// needed here beyond matching subjects back to the schedule-published exams.
export default function TeacherExamSchedule() {
  const { data: examsData, isLoading: examsLoading } = useQuery({
    queryKey: ['teacherExamSchedule'],
    queryFn: () => examinationsApi.getExams({ schedule_published: true, page_size: 9999, is_active: true }),
  })

  const { data: subjectsData, isLoading: subjectsLoading } = useQuery({
    queryKey: ['teacherExamScheduleSubjects'],
    queryFn: () => examinationsApi.getExamSubjects({ page_size: 9999 }),
  })

  const exams = examsData?.data?.results || examsData?.data || []
  const subjects = subjectsData?.data?.results || subjectsData?.data || []
  const isLoading = examsLoading || subjectsLoading

  const subjectsByExam = useMemo(() => {
    const map = {}
    subjects.forEach(s => {
      if (!map[s.exam]) map[s.exam] = []
      map[s.exam].push(s)
    })
    Object.values(map).forEach(list => list.sort((a, b) => (a.exam_date || '').localeCompare(b.exam_date || '')))
    return map
  }, [subjects])

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Exam Schedule</h1>
        <p className="text-sm text-gray-600">Published exam dates for your classes and subjects</p>
      </div>

      {exams.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">
          No exam schedules have been published for your classes yet.
        </div>
      ) : (
        <div className="space-y-4">
          {exams.map(exam => (
            <div key={exam.id} className="card">
              <div className="flex items-center justify-between flex-wrap gap-1 mb-2">
                <h3 className="text-sm font-semibold text-gray-900">
                  {exam.class_name} — {exam.name}
                </h3>
                <span className="text-xs text-gray-400">
                  {exam.start_date}{exam.end_date ? ` — ${exam.end_date}` : ''}
                </span>
              </div>
              {(subjectsByExam[exam.id] || []).length === 0 ? (
                <p className="text-xs text-gray-500">Subject dates not set yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 uppercase">
                        <th className="px-2 py-1 text-left">Subject</th>
                        <th className="px-2 py-1 text-left">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {subjectsByExam[exam.id].map(s => (
                        <tr key={s.id}>
                          <td className="px-2 py-1 text-gray-800">{s.subject_code || s.subject_name}</td>
                          <td className="px-2 py-1 text-gray-500">{s.exam_date || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
