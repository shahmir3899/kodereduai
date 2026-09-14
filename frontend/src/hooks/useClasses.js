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
    // Class rosters rarely change mid-session — avoid refetching this on every
    // tab focus/navigation across the many pages that consume this hook.
    staleTime: 5 * 60_000,
  })

  const classes = data?.data?.results || data?.data || []

  return { classes, isLoading, error }
}
