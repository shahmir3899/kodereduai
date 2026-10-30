import { useMutation, useQueryClient } from '@tanstack/react-query';
import { examinationsApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { ExamTypeRow, GradeRow } from '../services/examSetup';
import { useScopedQuery } from './useScopedQuery';

// Roots shared with the exam pickers (`examTypes`) so a new type shows there straight away. A grade
// scale change affects every result and report card, so those are refreshed as well.
const refresh = (qc: ReturnType<typeof useQueryClient>, roots: string[]) =>
  roots.forEach((root) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === root }));

export function useExamTypeSetupList() {
  return useScopedQuery('examTypes', ['setup'], async () => listOf<ExamTypeRow>((await examinationsApi.getExamTypes({ page_size: 9999 })).data));
}

export function useExamTypeActions() {
  const qc = useQueryClient();
  const done = () => refresh(qc, ['examTypes', 'exams']);
  return {
    create: useMutation({ mutationFn: (d: object) => examinationsApi.createExamType(d), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => examinationsApi.updateExamType(id, data), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: number) => examinationsApi.deleteExamType(id), onSuccess: done }),
  };
}

export function useGradeScale() {
  return useScopedQuery('gradeScales', ['list'], async () => listOf<GradeRow>((await examinationsApi.getGradeScales({ page_size: 9999 })).data));
}

export function useGradeScaleActions() {
  const qc = useQueryClient();
  const done = () => refresh(qc, ['gradeScales', 'results', 'reportCard']);
  return {
    create: useMutation({ mutationFn: (d: object) => examinationsApi.createGradeScale(d), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => examinationsApi.updateGradeScale(id, data), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: number) => examinationsApi.deleteGradeScale(id), onSuccess: done }),
  };
}
