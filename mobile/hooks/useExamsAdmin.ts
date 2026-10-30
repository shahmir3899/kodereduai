import { useMutation, useQueryClient } from '@tanstack/react-query';
import { academicsApi, examinationsApi, sessionsApi } from '../services/api';
import type { ClassSubjectDto } from '../services/examWizard';
import { listOf } from '../services/academicYear';
import type { ExamRow } from '../services/examsAdmin';
import { useAcademicYear } from './useAcademicYear';
import { useScopedPagedQuery, useScopedQuery } from './useScopedQuery';

export function useExamsPaged(status: string) {
  const { current } = useAcademicYear();
  return useScopedPagedQuery<ExamRow>('examsAdmin', ['paged', status, current?.id ?? null], async (page) => {
    const data = (await examinationsApi.getExams({
      page, page_size: 20, include_marks_status: true,
      ...(status ? { status } : {}), ...(current?.id ? { academic_year: current.id } : {}),
    })).data as { results?: ExamRow[]; next?: string | null; count?: number } | ExamRow[];
    if (Array.isArray(data)) return { results: data, next: null, count: data.length };
    return { results: data.results ?? [], next: data.next ?? null, count: data.count ?? 0 };
  }, { enabled: !!current?.id });
}

export function useExamTypeList() {
  return useScopedQuery('examTypes', [], async () =>
    listOf<{ id: number; name: string; is_active?: boolean }>((await examinationsApi.getExamTypes({ page_size: 200 })).data)
      .filter((t) => t.is_active !== false), { staleTime: 5 * 60_000 });
}

export function useTermList() {
  const { current } = useAcademicYear();
  return useScopedQuery('terms', [current?.id ?? null], async () =>
    listOf<{ id: number; name: string }>((await sessionsApi.getTerms({ ...(current?.id ? { academic_year: current.id } : {}), page_size: 50 })).data),
  { enabled: !!current?.id, staleTime: 5 * 60_000 });
}

export function useExamActions() {
  const qc = useQueryClient();
  const refresh = () => ['examsAdmin', 'exams', 'results'].forEach((root) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === root }));
  return {
    create: useMutation({ mutationFn: (d: object) => examinationsApi.createExam(d), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => examinationsApi.updateExam(id, data), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: number) => examinationsApi.deleteExam(id), onSuccess: refresh }),
    populate: useMutation({ mutationFn: (id: number) => examinationsApi.populateExamSubjects(id), onSuccess: refresh }),
  };
}

export function useClassSubjectRows() {
  return useScopedQuery('classSubjects', ['all'], async () =>
    listOf<ClassSubjectDto>((await academicsApi.getClassSubjects({ page_size: 9999 })).data), { staleTime: 5 * 60_000 });
}

export function useWizardCreate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (d: object) => examinationsApi.wizardCreateExamGroup(d),
    onSuccess: () => ['examsAdmin', 'exams', 'examGroups'].forEach((root) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === root })),
  });
}
