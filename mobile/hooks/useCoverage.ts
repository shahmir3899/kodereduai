import { useMutation, useQueryClient } from '@tanstack/react-query';
import { lmsApi } from '../services/api';
import { listOf } from '../services/academicYear';
import { plannedDateBody, topicParams, type CoverageFilter, type CoverageTopic } from '../services/curriculumCoverage';
import { useScopedQuery } from './useScopedQuery';

// Topics of one class and subject with their taught, tested and planned-date state.
export function useCoverageTopics(masterClassId: number | null, subjectId: number | null, coverage: CoverageFilter, yearId: number | null) {
  return useScopedQuery('curriculumCoverage', [masterClassId, subjectId, coverage, yearId], async () =>
    listOf<CoverageTopic>((await lmsApi.getTopics(topicParams({ masterClassId: masterClassId!, subjectId: subjectId!, coverage, academicYearId: yearId }))).data),
  { enabled: !!masterClassId && !!subjectId, staleTime: 30_000 });
}

export function useSetPlannedDate(yearId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ topicId, date }: { topicId: number; date: string | null }) => lmsApi.setTopicPlannedDate(topicId, plannedDateBody(yearId!, date)),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey.includes('curriculumCoverage') }),
  });
}
