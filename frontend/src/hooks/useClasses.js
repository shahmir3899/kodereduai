import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { classesApi } from '../services/api'

export function useClasses(schoolId) {
  const { activeSchool } = useAuth()
  const resolvedSchoolId = schoolId || activeSchool?.id

  const { data, isLoading, error } = useQuery({
    queryKey: ['classes', resolvedSchoolId],
    queryFn: () => classesApi.getClasses({ school_id: resolvedSchoolId, page_size: 9999 }),
    enabled: !!resolvedSchoolId,
  })

  const classes = data?.data?.results || data?.data || []

  return { classes, isLoading, error }
}
