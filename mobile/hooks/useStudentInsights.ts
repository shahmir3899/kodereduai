import { studentsApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { AIProfile, EarlierAssessment } from '../services/studentInsights';
import { useScopedQuery } from './useScopedQuery';

// Both name and score one student, so neither is kept on the phone (only the listed roots are, see
// services/queryRules.ts). The risk profile is worked out by the server each time it is asked.
export function useStudentAIProfile(id: number | null) {
  return useScopedQuery<AIProfile>('studentAIProfile', [id], async () =>
    (await studentsApi.getAIProfile(id!)).data as AIProfile, { enabled: !!id, staleTime: 5 * 60_000, retry: false });
}

export function useEarlierAssessments(id: number | null, enabled: boolean) {
  return useScopedQuery<EarlierAssessment[]>('studentEarlierAssessments', [id], async () =>
    listOf<EarlierAssessment>((await studentsApi.getEarlierAssessments(id!)).data), { enabled: enabled && !!id, staleTime: 5 * 60_000 });
}
