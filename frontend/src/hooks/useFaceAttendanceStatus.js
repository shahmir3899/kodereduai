import { useQuery } from '@tanstack/react-query'
import { faceAttendanceApi } from '../services/api'

/**
 * Shared read of GET /api/face-attendance/status/. Live Mobile capture and
 * Group Photo capture are unconditionally available to every school
 * (confirmed product decision) — there's no flag left to gate them on.
 * Fixed Camera capture has no "enabled" concept either; fixedCameraStatus
 * reflects whether the school actually has an on-prem device installed and
 * how recently it's been seen, purely for display. Uses the same
 * ['faceStatus'] query key FaceAttendancePage already fetches with, so this
 * is a cache hit there rather than a second network request.
 */
export function useFaceAttendanceStatus() {
  const { data, isLoading, ...rest } = useQuery({
    queryKey: ['faceStatus'],
    queryFn: () => faceAttendanceApi.getStatus(),
  })
  const status = data?.data

  // `...rest` carries react-query's own `status` ('success'/'pending'); it must
  // come first so it can't overwrite the server status object below — that
  // overwrite made the "library not installed" banner show permanently.
  return {
    ...rest,
    status,
    isLoading,
    // 'not_installed' | 'active' | 'inactive' while loading — no device
    // controls are shown until we actually know, since claiming "not
    // installed" prematurely would be misleading.
    fixedCameraStatus: status?.fixed_camera_status ?? null,
  }
}
