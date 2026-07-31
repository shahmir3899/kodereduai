import { useQuery } from '@tanstack/react-query'
import { faceAttendanceApi } from '../services/api'

/**
 * Shared read of GET /api/face-attendance/status/. Tier A (mobile capture)
 * and Tier C (group photo) are unconditionally available to every school
 * (2026-07 product decision) — there's no flag left to gate them on. Tier B
 * (fixed camera) has no "enabled" concept either; tierBStatus reflects
 * whether the school actually has an on-prem device installed and how
 * recently it's been seen, purely for display. Uses the same ['faceStatus']
 * query key FaceAttendancePage already fetches with, so this is a cache hit
 * there rather than a second network request.
 */
export function useFaceAttendanceStatus() {
  const { data, isLoading, ...rest } = useQuery({
    queryKey: ['faceStatus'],
    queryFn: () => faceAttendanceApi.getStatus(),
  })
  const status = data?.data

  return {
    status,
    isLoading,
    // 'not_installed' | 'active' | 'inactive' while loading — no device
    // controls are shown until we actually know, since claiming "not
    // installed" prematurely would be misleading.
    tierBStatus: status?.tier_b_status ?? null,
    ...rest,
  }
}
