import { useMutation, useQueryClient } from '@tanstack/react-query';
import { examinationsApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { DateSheetSubjectDto, ExamGroupRow } from '../services/examGroups';
import { useAcademicYear } from './useAcademicYear';
import { useScopedQuery } from './useScopedQuery';

// Publishing changes what students, parents and teachers can see, so every list that shows exams,
// results or report cards is refreshed afterwards.
const ROOTS = ['examGroups', 'examsAdmin', 'exams', 'results', 'reportCard', 'dateSheet'];
const refreshAll = (qc: ReturnType<typeof useQueryClient>) =>
  ROOTS.forEach((root) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === root }));

export function useExamGroups() {
  const { current } = useAcademicYear();
  return useScopedQuery('examGroups', [current?.id ?? null], async () =>
    listOf<ExamGroupRow>((await examinationsApi.getExamGroups({ page_size: 9999, ...(current?.id ? { academic_year: current.id } : {}) })).data),
  { enabled: !!current?.id });
}

export function useDateSheet(groupId: number) {
  return useScopedQuery('dateSheet', [groupId], async () =>
    (await examinationsApi.getDateSheet(groupId)).data as {
      group_name: string; start_date: string | null; end_date: string | null; subjects: DateSheetSubjectDto[];
    });
}

export function useDateSheetActions(groupId: number) {
  const qc = useQueryClient();
  const done = () => refreshAll(qc);
  return {
    saveRow: useMutation({ mutationFn: (entry: object) => examinationsApi.updateDateSheet(groupId, [entry]), onSuccess: done }),
    setSubjectDate: useMutation({
      mutationFn: (v: { subjectId: number; date: string | null }) => examinationsApi.updateDateBySubject(groupId, { subject_id: v.subjectId, exam_date: v.date }),
      onSuccess: done,
    }),
  };
}

export function useGroupPublishing() {
  const qc = useQueryClient();
  const done = () => refreshAll(qc);
  return {
    publishSchedule: useMutation({ mutationFn: (id: number) => examinationsApi.publishScheduleAll(id), onSuccess: done }),
    unpublishSchedule: useMutation({ mutationFn: (id: number) => examinationsApi.unpublishScheduleAll(id), onSuccess: done }),
    announceResults: useMutation({ mutationFn: (id: number) => examinationsApi.announceResultsAll(id), onSuccess: done }),
    unpublishResults: useMutation({ mutationFn: (id: number) => examinationsApi.unpublishResultsAll(id), onSuccess: done }),
    // One class's exam inside a group.
    publishExamSchedule: useMutation({ mutationFn: (id: number) => examinationsApi.publishExamSchedule(id), onSuccess: done }),
    unpublishExamSchedule: useMutation({ mutationFn: (id: number) => examinationsApi.unpublishExamSchedule(id), onSuccess: done }),
    announceExam: useMutation({ mutationFn: (id: number) => examinationsApi.announceExamResults(id), onSuccess: done }),
    unpublishExam: useMutation({ mutationFn: (id: number) => examinationsApi.unpublishExamResults(id), onSuccess: done }),
  };
}
