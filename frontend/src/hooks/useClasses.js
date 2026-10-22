import { useMemo } from 'react'
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

  // useMemo keeps the array identity stable while loading: a fresh [] every render made consumers' effects
  // (e.g. the fee-structure card views) re-run and set state in a loop.
  const classes = useMemo(() => data?.data?.results || data?.data || [], [data])

  return { classes, isLoading, error }
}
