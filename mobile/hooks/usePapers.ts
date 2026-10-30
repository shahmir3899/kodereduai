import { useMutation, useQueryClient } from '@tanstack/react-query';
import { examinationsApi } from '../services/api';
import type { Paper } from '../services/paperBuilder';
import { useScopedPagedQuery, useScopedQuery } from './useScopedQuery';

export function usePapersPaged(search: string) {
  return useScopedPagedQuery<Paper>('examPapers', ['paged', search], async (page) => {
    const data = (await examinationsApi.getExamPapers({ page, page_size: 20, ...(search ? { search } : {}) })).data as
      { results?: Paper[]; next?: string | null; count?: number } | Paper[];
    if (Array.isArray(data)) return { results: data, next: null, count: data.length };
    return { results: data.results ?? [], next: data.next ?? null, count: data.count ?? 0 };
  });
}

export function usePaper(id: number | null) {
  return useScopedQuery('examPaper', [id], async () => (await examinationsApi.getExamPaper(id!)).data as Paper, { enabled: !!id, staleTime: 0 });
}

export function usePaperActions() {
  const qc = useQueryClient();
  const refresh = () => ['examPapers', 'examPaper'].forEach((root) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === root }));
  return {
    create: useMutation({ mutationFn: (d: object) => examinationsApi.createExamPaper(d), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => examinationsApi.updateExamPaper(id, data), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: number) => examinationsApi.deleteExamPaper(id), onSuccess: refresh }),
    ensure: useMutation({ mutationFn: (d: object) => examinationsApi.ensurePaperDraft(d), onSuccess: refresh }),
    autosave: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => examinationsApi.autosavePaperDraft(id, data), onSuccess: refresh }),
  };
}
