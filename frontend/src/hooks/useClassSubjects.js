import { useQuery } from '@tanstack/react-query'
import { academicsApi } from '../services/api'

export function useClassSubjects(classId, sessionClassId) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['classSubjects', classId, sessionClassId],
    queryFn: () => academicsApi.getClassSubjects({
      class_obj: classId,
      ...(sessionClassId && { session_class: sessionClassId }),
    }),
    enabled: !!classId,
    // Subject-teacher assignments change occasionally (HR reassignment), but not
    // every few seconds — avoid refetching on every tab focus across consumers.
    staleTime: 2 * 60_000,
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
