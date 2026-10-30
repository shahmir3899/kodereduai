import { schoolToday, schoolYMD } from '../utils/schoolTime'
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
  const { user, isStaffMember, activeSchool, isModuleEnabled, effectiveRole } = useAuth()
  const { activeAcademicYear, loading: academicYearLoading } = useAcademicYear()

  const applies = DASHBOARD_BOOTSTRAP_ENABLED
    && (effectiveRole === 'SCHOOL_ADMIN' || effectiveRole === 'PRINCIPAL')
  const schoolId = activeSchool?.id
  // The same year id the tiles put in their query keys, so what we seed is what they read.
  const academicYearId = activeAcademicYear?.id

  const today = schoolToday()
  const { month, year } = schoolYMD()

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

  // Admins with several schools read the fee tile from the all-schools key, which the combined
  // call does not seed (it only seeds the single-school key). Holding that tile back would just
  // add a round trip after the combined call, so it goes out in parallel. Same test as
  // useFeeCollectionSummary's isMulti.
  const feeIsMultiSchool = !isStaffMember && (user?.schools?.length > 1 || !!user?.is_super_admin)
  const feeReady = settled || feeIsMultiSchool

  return { settled, waiting: !settled, feeReady, feeWaiting: !feeReady }
}
