import { useMutation, useQueryClient } from '@tanstack/react-query';
import { examinationsApi } from '../services/api';
import type { Worksheet } from '../services/worksheets';
import { useScopedPagedQuery, useScopedQuery } from './useScopedQuery';

export function useWorksheetsPaged(search: string, filters: { classId?: number | null; subject?: number | null; status?: string } = {}) {
  return useScopedPagedQuery<Worksheet>('worksheets', ['paged', search, filters.classId ?? null, filters.subject ?? null, filters.status ?? ''], async (page) => {
    const data = (await examinationsApi.getWorksheets({
      page, page_size: 20, ...(search ? { search } : {}),
      ...(filters.classId ? { class_obj: filters.classId } : {}), ...(filters.subject ? { subject: filters.subject } : {}), ...(filters.status ? { status: filters.status } : {}),
    })).data as { results?: Worksheet[]; next?: string | null; count?: number } | Worksheet[];
    if (Array.isArray(data)) return { results: data, next: null, count: data.length };
    return { results: data.results ?? [], next: data.next ?? null, count: data.count ?? 0 };
  });
}

export function useWorksheet(id: number | null) {
  return useScopedQuery('worksheet', [id], async () => (await examinationsApi.getWorksheet(id as number)).data as Worksheet, { enabled: !!id, staleTime: 0 });
}

export function useWorksheetActions() {
  const qc = useQueryClient();
  const refresh = () => ['worksheets', 'worksheet', 'questions'].forEach((root) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === root }));
  return {
    ensure: useMutation({ mutationFn: (d: object) => examinationsApi.ensureWorksheetDraft(d), onSuccess: refresh }),
    // Autosave does not refetch the worksheet: the screen holds the draft, and a refetch would overwrite what is being typed.
    autosave: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => examinationsApi.autosaveWorksheetDraft(id, data) }),
    remove: useMutation({ mutationFn: (id: number) => examinationsApi.deleteWorksheet(id), onSuccess: refresh }),
    duplicate: useMutation({ mutationFn: (id: number) => examinationsApi.duplicateWorksheet(id), onSuccess: refresh }),
  };
}
