import { useQuery } from '@tanstack/react-query'
import { sessionsApi } from '../services/api'

const localDate = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Single source for "is today an off day?" across role dashboards. Uses the
 * calendar day-status endpoint instead of the school-wide daily attendance
 * report, which counts every student just to read one flag.
 * `date` is the local calendar date (not toISOString, which is UTC and can be
 * yesterday/tomorrow for schools east/west of Greenwich).
 */
export default function useOffDay({ classId, enabled = true } = {}) {
  const today = localDate()
  const { data, isLoading } = useQuery({
    queryKey: ['offDay', today, classId || null],
    queryFn: () => sessionsApi.getCalendarDayStatus({
      date_from: today,
      date_to: today,
      class_id: classId || undefined,
    }),
    enabled,
    staleTime: 5 * 60 * 1000,
  })

  const day = data?.data?.days?.[today] || null
  const offDayTypes = day?.off_day_types || []
  return {
    today,
    isOffDay: !!day?.is_off_day,
    offDayTypes,
    label: day?.is_off_day ? `OFF day${offDayTypes.length ? `: ${offDayTypes.join(', ')}` : ''}` : null,
    isLoading,
  }
}
