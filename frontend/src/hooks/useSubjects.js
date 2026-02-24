import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { academicsApi } from '../services/api'

export function useSubjects(schoolId) {
  const { activeSchool } = useAuth()
  const resolvedSchoolId = schoolId || activeSchool?.id

  const { data, isLoading, error } = useQuery({
    queryKey: ['subjects', resolvedSchoolId],
    queryFn: () => academicsApi.getSubjects({ school_id: resolvedSchoolId, page_size: 9999 }),
    enabled: !!resolvedSchoolId,
  })

  const subjects = data?.data?.results || data?.data || []

  return { subjects, isLoading, error }
}
