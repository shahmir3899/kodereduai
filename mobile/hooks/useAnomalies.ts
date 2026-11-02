import { useMutation, useQueryClient } from '@tanstack/react-query';
import { attendanceApi, bootstrapApi } from '../services/api';
import { listOf } from '../services/academicYear';
import { anomalyParams, resolvePayload, type Anomaly, type StateFilter } from '../services/anomalies';
import { todayString } from '../services/attendanceEntry';
import { useAcademicYear } from './useAcademicYear';
import { useScopedQuery } from './useScopedQuery';

export function useAnomalies(state: StateFilter, type: string) {
  return useScopedQuery('attendanceAnomalies', [state, type], async () =>
    listOf<Anomaly>((await attendanceApi.getAnomalies(anomalyParams(state, type))).data), { staleTime: 0 });
}

export function useResolveAnomaly() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notes }: { id: number; notes: string }) => attendanceApi.resolveAnomaly(id, resolvePayload(notes)),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => ['attendanceAnomalies', 'attendanceHub'].includes(q.queryKey[0] as string) }),
  });
}

// The two numbers on the attendance hub: students not marked today and open anomalies. A failure shows
// nothing rather than a wrong number.
export function useAttendanceHubStats() {
  const year = useAcademicYear();
  const today = todayString();
  const day = useScopedQuery('attendanceHub', ['day', today, year.current?.id ?? null], async () => {
    const d = (await bootstrapApi.getAdminDashboard({ date: today, academic_year: year.current?.id, sections: 'attendance' })).data as
      { attendance?: { is_off_day?: boolean; not_marked_count?: number; total_students?: number } };
    return d.attendance ?? null;
  }, { enabled: !year.isLoading, staleTime: 0 });
  const open = useScopedQuery('attendanceHub', ['openAnomalies'], async () => {
    const r = (await attendanceApi.getAnomalies({ is_resolved: false, page_size: 1 })).data as { count?: number; results?: unknown[] } | unknown[];
    return Array.isArray(r) ? r.length : (r.count ?? r.results?.length ?? 0);
  }, { staleTime: 0, retry: false });
  return { day, open };
}
