import { useMutation, useQueryClient } from '@tanstack/react-query';
import { examinationsApi, lmsApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { CoverageStats, ExamOption, LessonOption } from '../services/questionExtras';
import type { Paper } from '../services/paperBuilder';
import { useScopedPagedQuery, useScopedQuery } from './useScopedQuery';

export function usePapersPaged(search: string, filters: { classId?: number | null; subject?: number | null; status?: string } = {}) {
  return useScopedPagedQuery<Paper>('examPapers', ['paged', search, filters.classId ?? null, filters.subject ?? null, filters.status ?? ''], async (page) => {
    const data = (await examinationsApi.getExamPapers({
      page, page_size: 20, ...(search ? { search } : {}),
      ...(filters.classId ? { class_obj: filters.classId } : {}), ...(filters.subject ? { subject: filters.subject } : {}), ...(filters.status ? { status: filters.status } : {}),
    })).data as
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
    linkLessons: useMutation({ mutationFn: ({ id, ids }: { id: number; ids: number[] }) => examinationsApi.linkPaperLessonPlans(id, { lesson_plan_ids: ids }), onSuccess: refresh }),
    removeMany: useMutation({ mutationFn: (ids: number[]) => examinationsApi.bulkDeleteExamPapers(ids), onSuccess: refresh }),
    ensure: useMutation({ mutationFn: (d: object) => examinationsApi.ensurePaperDraft(d), onSuccess: refresh }),
    autosave: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => examinationsApi.autosavePaperDraft(id, data), onSuccess: refresh }),
  };
}

// Exams of the paper's class this academic year (an exam always belongs to one class and year).
export function usePaperExams(classId: number | null, yearId: number | null | undefined) {
  return useScopedQuery('examPaperExams', [classId, yearId ?? null], async () =>
    listOf<ExamOption>((await examinationsApi.getExams({ page_size: 999, academic_year: yearId, class_obj: classId })).data), { enabled: !!classId && !!yearId });
}

// Lesson plans of the class and subject; their planned topics narrow the question picker.
export function usePaperLessons(classId: number | null, subjectId: number | null) {
  return useScopedQuery('examPaperLessons', [classId, subjectId], async () =>
    listOf<LessonOption>((await lmsApi.getLessonPlans({ page_size: 999, class_id: classId, subject_id: subjectId })).data), { enabled: !!classId && !!subjectId });
}

export function usePaperCoverage(paperId: number | null) {
  return useScopedQuery<CoverageStats>('examPaper', ['coverage', paperId], async () => (await examinationsApi.getPaperCoverage(paperId as number)).data as CoverageStats, { enabled: !!paperId, staleTime: 0 });
}
