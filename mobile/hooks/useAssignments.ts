import { useMutation, useQueryClient } from '@tanstack/react-query';
import { academicsApi, hrApi, lmsApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { Assignment, Submission } from '../services/assignments';
import { useAcademicYear } from './useAcademicYear';
import { useScopedQuery } from './useScopedQuery';

// The whole academic year in one request; class, subject, status and type filter on the phone.
// Teacher section scoping is enforced server-side.
export function useAssignments() {
  const year = useAcademicYear();
  return useScopedQuery('assignments', [year.current?.id ?? null], async () =>
    listOf<Assignment>((await lmsApi.getAssignments({
      ...(year.current?.id && { academic_year: year.current.id }), page_size: 9999,
    })).data),
  { enabled: !year.isLoading, staleTime: 30_000 });
}

export function useAssignment(id: number | null) {
  return useScopedQuery('assignment', [id], async () => (await lmsApi.getAssignment(id!)).data as Assignment,
    { enabled: !!id, staleTime: 0 });
}

// Fresh every time: a teacher grading expects the latest hand-ins.
export function useSubmissions(assignmentId: number | null) {
  return useScopedQuery('submissions', [assignmentId], async () =>
    listOf<Submission>((await lmsApi.getSubmissions({ assignment_id: assignmentId, page_size: 9999 })).data),
  { enabled: !!assignmentId, staleTime: 0 });
}

// 'subjects' is on the persisted reference-data list.
export function useSubjectList() {
  return useScopedQuery('subjects', [], async () =>
    listOf<{ id: number; name: string }>((await academicsApi.getSubjects({ page_size: 9999 })).data),
  { staleTime: 5 * 60_000 });
}

// Teacher picker for the form. Some schools add teachers as staff rows with no linked user
// account, in which case the role filter finds nobody; the web then falls back to everyone.
export function useTeacherStaff() {
  return useScopedQuery('staff', ['teachers'], async () => {
    const asTeachers = listOf<{ id: number; user?: number | null; full_name?: string }>(
      (await hrApi.getStaff({ role: 'TEACHER', page_size: 9999 })).data,
    );
    if (asTeachers.length > 0) return asTeachers;
    return listOf<{ id: number; user?: number | null; full_name?: string }>((await hrApi.getStaff({ page_size: 9999 })).data);
  }, { staleTime: 5 * 60_000 });
}

// Every assignment change refreshes the list (and the dashboard's "to grade" count).
export function useAssignmentActions() {
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['assignments'] });
    queryClient.invalidateQueries({ queryKey: ['assignment'] });
    queryClient.invalidateQueries({ queryKey: ['pendingSubmissions'] });
  };
  return {
    create: useMutation({ mutationFn: (data: Record<string, unknown>) => lmsApi.createAssignment(data), onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => lmsApi.updateAssignment(id, data),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: number) => lmsApi.deleteAssignment(id), onSuccess: refresh }),
    publish: useMutation({ mutationFn: (id: number) => lmsApi.publishAssignment(id), onSuccess: refresh }),
    close: useMutation({ mutationFn: (id: number) => lmsApi.closeAssignment(id), onSuccess: refresh }),
  };
}

export function useSubmissionActions() {
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['submissions'] });
    queryClient.invalidateQueries({ queryKey: ['assignments'] });
    queryClient.invalidateQueries({ queryKey: ['pendingSubmissions'] });
  };
  return {
    grade: useMutation({
      mutationFn: ({ id, marks, feedback }: { id: number; marks: number; feedback: string }) =>
        lmsApi.gradeSubmission(id, { marks_obtained: marks, feedback }),
      onSuccess: refresh,
    }),
    returnToStudent: useMutation({ mutationFn: (id: number) => lmsApi.returnSubmission(id), onSuccess: refresh }),
  };
}
