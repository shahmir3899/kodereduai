import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { useAcademicYear } from '../contexts/AcademicYearContext'
import {
  DASHBOARD_BOOTSTRAP_ENABLED, DASHBOARD_BOOTSTRAP_TIMEOUT_MS, fetchDashboardBootstrap,
} from '../utils/dashboardBootstrap'

/**
 * The admin/principal dashboard's single data source for its summary tiles.
 *
 * Why the tiles wait on it: they used to mount at the same moment the login preload started
 * the combined request, so each tile fired its own call in parallel and the combined result
 * arrived too late to prevent any of them. `settled` flips true once the combined call has
 * seeded the cache, failed, or timed out; the tiles enable on it, then read the seeded cache
 * (or fetch themselves if nothing was seeded). `waiting` is for loading skeletons, because a
 * disabled query reports isLoading=false and the tile would flash an empty value.
 */
export function useDashboardBootstrap() {
  const queryClient = useQueryClient()
  const { activeSchool, isModuleEnabled, effectiveRole } = useAuth()
  const { activeAcademicYear, loading: academicYearLoading } = useAcademicYear()

  const applies = DASHBOARD_BOOTSTRAP_ENABLED
    && (effectiveRole === 'SCHOOL_ADMIN' || effectiveRole === 'PRINCIPAL')
  const schoolId = activeSchool?.id
  // The same year id the tiles put in their query keys, so what we seed is what they read.
  const academicYearId = activeAcademicYear?.id

  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const month = now.getMonth() + 1
  const year = now.getFullYear()

  const query = useQuery({
    queryKey: ['adminDashboardBootstrap', today, schoolId, academicYearId ?? null, month, year],
    queryFn: () => {
      const work = fetchDashboardBootstrap(queryClient, {
        today, schoolId, academicYearId, month, year, isModuleOn: isModuleEnabled,
      }).catch(() => null)
      const timeout = new Promise((resolve) => setTimeout(() => resolve(null), DASHBOARD_BOOTSTRAP_TIMEOUT_MS))
      return Promise.race([work, timeout])
    },
    enabled: applies && !!schoolId && !academicYearLoading,
    staleTime: 2 * 60 * 1000,
    retry: false,
  })

  const settled = !applies || query.isSuccess || query.isError
  return { settled, waiting: !settled }
}
