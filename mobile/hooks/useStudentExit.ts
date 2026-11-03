import { useMutation, useQueryClient } from '@tanstack/react-query';
import { studentExitsApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { DestinationClasses, ExitDestination, StudentExitCase } from '../services/studentExit';
import { useScopedQuery } from './useScopedQuery';

// Exit cases name a student and money owed, so none of this is kept on the phone (only the listed roots
// are, see services/queryRules.ts); each screen asks the server fresh.

// The exit still being worked for a student, or null when there is none.
export function useOpenExit(studentId: number | null, enabled = true) {
  return useScopedQuery<StudentExitCase | null>('studentExit', [studentId], async () => {
    const rows = listOf<StudentExitCase>((await studentExitsApi.getExits({ student: studentId, status: 'OPEN' })).data);
    return rows[0] ?? null;
  }, { enabled: enabled && !!studentId, staleTime: 0, retry: false });
}

export function useExitDestinations(enabled: boolean) {
  return useScopedQuery<ExitDestination[]>('studentExitDestinations', [], async () =>
    listOf<ExitDestination>((await studentExitsApi.getDestinations()).data), { enabled, staleTime: 5 * 60_000 });
}

// Classes (with the rolls taken) a transferring student can join at a branch, for the year of the leaving date.
export function useDestinationClasses(school: number | null, leavingDate: string, enabled: boolean) {
  return useScopedQuery<DestinationClasses>('studentExitDestinationClasses', [school, leavingDate], async () =>
    (await studentExitsApi.getDestinationClasses({ school: school!, leaving_date: leavingDate })).data as DestinationClasses,
  { enabled: enabled && !!school && /^\d{4}-\d{2}-\d{2}$/.test(leavingDate), staleTime: 0, retry: false });
}

// A change to an exit, a student's status or class, or what they owe shows up in every list that carries it.
const REFRESH_ROOTS = ['studentExit', 'students', 'student', 'student-edit', 'studentProfileSummary', 'studentEnrollmentHistory', 'feePayments', 'feeSummary', 'studentFees', 'adminDashboard'];

export function useExitActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ predicate: (q) => REFRESH_ROOTS.includes(q.queryKey[0] as string) });
  return {
    start: useMutation({ mutationFn: (data: object) => studentExitsApi.startExit(data), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => studentExitsApi.updateExit(id, data), onSuccess: refresh }),
    refresh: useMutation({ mutationFn: (id: number) => studentExitsApi.refreshExit(id), onSuccess: refresh }),
    waive: useMutation({ mutationFn: ({ id, kind, reason }: { id: number; kind: string; reason: string }) => studentExitsApi.waiveItem(id, kind, { reason }), onSuccess: refresh }),
    unwaive: useMutation({ mutationFn: ({ id, kind }: { id: number; kind: string }) => studentExitsApi.unwaiveItem(id, kind), onSuccess: refresh }),
    carry: useMutation({ mutationFn: ({ id, kind }: { id: number; kind: string }) => studentExitsApi.carryItem(id, kind), onSuccess: refresh }),
    finalize: useMutation({ mutationFn: (id: number) => studentExitsApi.finalizeExit(id), onSuccess: refresh }),
    cancel: useMutation({ mutationFn: ({ id, reason }: { id: number; reason: string }) => studentExitsApi.cancelExit(id, { reason }), onSuccess: refresh }),
    readmit: useMutation({ mutationFn: (data: object) => studentExitsApi.readmit(data), onSuccess: refresh }),
  };
}
