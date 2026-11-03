import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionsApi } from '../services/api';
import { previewPayload, type RenumberOrder, type RenumberPreview } from '../services/renumber';
import { useScopedQuery } from './useScopedQuery';

// The server's preview of a section's new roll numbers. Always fresh (a roll changed elsewhere must
// show), and never kept on the phone: it names students.
export function useRenumberPreview(sectionId: number, order: RenumberOrder, enabled: boolean) {
  return useScopedQuery<RenumberPreview>('renumberPreview', [sectionId, order === 'manual' ? 'roll' : order], async () =>
    (await sessionsApi.renumberSection(sectionId, previewPayload(order))).data as RenumberPreview,
  { enabled, staleTime: 0, retry: false });
}

export function useRenumberApply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: object }) => sessionsApi.renumberSection(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => ['students', 'student', 'renumberPreview', 'attendance', 'studentProfileSummary'].includes(q.queryKey[0] as string) });
    },
  });
}
