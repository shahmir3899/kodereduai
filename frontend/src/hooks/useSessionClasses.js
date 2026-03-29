import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { sessionsApi } from '../services/api'

export function useSessionClasses(academicYearId, schoolId) {
  const { activeSchool } = useAuth()
  const resolvedSchoolId = schoolId || activeSchool?.id

  const { data, isLoading, error } = useQuery({
    queryKey: ['session-classes', resolvedSchoolId, academicYearId],
    queryFn: () => sessionsApi.getSessionClasses({
      school_id: resolvedSchoolId,
      academic_year: academicYearId,
      page_size: 9999,
      is_active: true,
    }),
    enabled: !!resolvedSchoolId && !!academicYearId,
  })

  const sessionClasses = data?.data?.results || data?.data || []

  return { sessionClasses, isLoading, error }
}
