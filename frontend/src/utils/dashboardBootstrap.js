import {
  admissionsApi, bootstrapApi, hostelApi, inventoryApi, libraryApi, transportApi,
} from '../services/api'
import { feeMonthSummaryKey } from './feeMonthSummary'

// Escape hatch: VITE_DASHBOARD_BOOTSTRAP=false makes the dashboards fetch each tile on its own
// again (the login preload then feeds the cache, as before). On by default.
export const DASHBOARD_BOOTSTRAP_ENABLED =
  String(import.meta.env.VITE_DASHBOARD_BOOTSTRAP ?? 'true').toLowerCase() !== 'false'

// If the combined call is slow the tiles must not stay blank: past this the dashboard
// falls back to its own per-tile requests.
export const DASHBOARD_BOOTSTRAP_TIMEOUT_MS = 2000

const SECTIONS = 'attendance,hr,finance,transport,library,hostel,inventory,admissions'
const STALE = 2 * 60 * 1000

/**
 * One request for the numbers the admin/principal dashboard tiles show, written into the
 * query keys those tiles already read. A section the server returns as null (a failed
 * builder) falls back to that module's own endpoint.
 * `isModuleOn(key)` is the caller's module check (the preload and the page resolve it differently).
 */
export async function fetchDashboardBootstrap(queryClient, {
  today, schoolId, academicYearId, month, year, isModuleOn,
}) {
  const res = await bootstrapApi.getAdminDashboard({
    sections: SECTIONS,
    date: today,
    ...(academicYearId && { academic_year: academicYearId }),
    month,
    year,
  })
  const data = res.data || {}

  if (data.attendance != null) {
    queryClient.setQueryData(['dailyReport', today, schoolId, academicYearId], { data: data.attendance })
  }
  if (data.hr != null) {
    queryClient.setQueryData(['hrDashboardStats'], { data: data.hr })
  }
  if (data.finance != null) {
    // Every dashboard reads the month's fee numbers through useFeeMonthSummary, so one
    // seeded key covers them all.
    queryClient.setQueryData(feeMonthSummaryKey('single', month, year, academicYearId), { data: data.finance })
  }

  const moduleSeeds = [
    ['transport', ['transportDashboard'], data.transport, () => transportApi.getDashboardStats()],
    ['library', ['libraryStats'], data.library, () => libraryApi.getStats()],
    ['hostel', ['hostelDashboard'], data.hostel, () => hostelApi.getDashboard()],
    ['inventory', ['inventoryDashboard'], data.inventory, () => inventoryApi.getDashboard()],
  ]
  for (const [moduleKey, queryKey, section, fetchOwn] of moduleSeeds) {
    if (!isModuleOn(moduleKey)) continue
    if (section != null) {
      queryClient.setQueryData(queryKey, { data: section })
    } else {
      void queryClient.prefetchQuery({ queryKey, queryFn: fetchOwn, staleTime: STALE })
    }
  }
  if (isModuleOn('admissions')) {
    if (data.admissions_new_count != null) {
      queryClient.setQueryData(['admissionsNewCount'], { data: { count: data.admissions_new_count } })
    } else {
      void queryClient.prefetchQuery({
        queryKey: ['admissionsNewCount'],
        queryFn: () => admissionsApi.getEnquiries({ status: 'NEW', page_size: 1 }),
        staleTime: STALE,
      })
    }
  }
  return res
}
