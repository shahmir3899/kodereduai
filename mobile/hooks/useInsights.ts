import { insightsApi } from '../services/api';
import {
  academicRiskSummary, attendanceRiskSummary, staffRiskSummary, studentRiskSummary, type InsightKind, type InsightSummary,
} from '../services/insights';
import { useAcademicYear } from './useAcademicYear';
import { useScopedQuery } from './useScopedQuery';

// The risk scans are slow and read a lot of data, so a result is kept for ten minutes and a new
// scan runs only when asked (the Refresh button). They hold personal data about named students
// and staff, so they are never written to the phone's storage.
export function useInsight(kind: InsightKind, enabled: boolean) {
  const { current } = useAcademicYear();
  const year = current?.id ?? null;
  return useScopedQuery<{ summary: InsightSummary; cachedAt?: string }>('insights', [kind, year], async () => {
    const params = year ? { academic_year: year } : {};
    const data = (kind === 'students' ? await insightsApi.studentRisk(params)
      : kind === 'attendance' ? await insightsApi.attendanceRisk(params)
      : kind === 'academic' ? await insightsApi.academicRisk(params)
      : await insightsApi.staffRisk()).data as Record<string, unknown>;
    const summarise = kind === 'students' ? studentRiskSummary : kind === 'attendance' ? attendanceRiskSummary : kind === 'academic' ? academicRiskSummary : staffRiskSummary;
    return { summary: summarise(data), cachedAt: data.cached_at as string | undefined };
  }, { enabled: enabled && (kind === 'staff' || !!year), staleTime: 10 * 60_000 });
}
