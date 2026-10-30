import { useMutation, useQueryClient } from '@tanstack/react-query';
import { examinationsApi } from '../services/api';
import type { Question } from '../services/questionBank';
import { useScopedPagedQuery } from './useScopedQuery';

export function useQuestionsPaged(search: string, subject: number | null, type: string, difficulty: string) {
  return useScopedPagedQuery<Question>('questions', ['paged', search, subject, type, difficulty], async (page) => {
    const data = (await examinationsApi.getQuestions({
      page, page_size: 20,
      ...(search ? { search } : {}), ...(subject ? { subject } : {}),
      ...(type ? { question_type: type } : {}), ...(difficulty ? { difficulty } : {}),
    })).data as { results?: Question[]; next?: string | null; count?: number } | Question[];
    if (Array.isArray(data)) return { results: data, next: null, count: data.length };
    return { results: data.results ?? [], next: data.next ?? null, count: data.count ?? 0 };
  });
}

export function useQuestionActions() {
  const qc = useQueryClient();
  // The paper builder and the content counts on the dashboards read the same question lists.
  const refresh = () => ['questions', 'examPapers'].forEach((root) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === root }));
  return {
    create: useMutation({ mutationFn: (d: object) => examinationsApi.createQuestion(d), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => examinationsApi.updateQuestion(id, data), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: number) => examinationsApi.deleteQuestion(id), onSuccess: refresh }),
    uploadPicture: useMutation({ mutationFn: ({ id, form }: { id: number; form: FormData }) => examinationsApi.uploadQuestionPicture(id, form), onSuccess: refresh }),
    removePicture: useMutation({ mutationFn: ({ id, slot }: { id: number; slot: string }) => examinationsApi.removeQuestionPicture(id, slot), onSuccess: refresh }),
  };
}
