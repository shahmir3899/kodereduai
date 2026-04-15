import { useQuery } from '@tanstack/react-query'
import { academicsApi } from '../services/api'

export function useClassSubjects(classId) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['classSubjects', classId],
    queryFn: () => academicsApi.getClassSubjectsByClass(classId),
    enabled: !!classId,
  })

  const assignments = data?.data?.results || data?.data || []
  const seen = new Set()
  const subjects = assignments
    .filter((assignment) => {
      if (seen.has(assignment.subject)) {
        return false
      }
      seen.add(assignment.subject)
      return true
    })
    .map((assignment) => ({
      id: assignment.subject,
      name: assignment.subject_name,
      code: assignment.subject_code,
      assignmentId: assignment.id,
      teacherName: assignment.teacher_name,
    }))

  return { assignments, subjects, isLoading, error }
}
