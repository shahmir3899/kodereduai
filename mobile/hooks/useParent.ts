import { useMutation, useQueryClient } from '@tanstack/react-query';
import { parentsApi, transportApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type {
  ChildAttendanceRow, ChildLeave, ChildLink, ChildOverview, ChildTimetableRow, TrackResponse,
} from '../services/parentPortal';
import type {
  ExamScheduleExam, LibraryIssue, PortalFee, PortalResultExam, PortalTransport,
} from '../services/studentPortal';
import { useScopedQuery } from './useScopedQuery';

// A parent's data, one child at a time. Fees, results and attendance are in memory only and
// the fee query uses the always-stale money root (services/queryRules.ts).

export function useChildren() {
  return useScopedQuery('parentChildren', [], async () => listOf<ChildLink>((await parentsApi.getMyChildren()).data), { staleTime: 5 * 60_000 });
}

export function useChildOverview(studentId: number, enabled = true) {
  return useScopedQuery('childOverview', [studentId], async () =>
    (await parentsApi.getChildOverview(studentId)).data as ChildOverview, { enabled: enabled && !!studentId, staleTime: 60_000 });
}

export function useChildAttendance(studentId: number, year: number, month: number) {
  return useScopedQuery('childAttendance', [studentId, year, month], async () =>
    listOf<ChildAttendanceRow>((await parentsApi.getChildAttendance(studentId, { month, year })).data), { staleTime: 60_000 });
}

export function useChildFees(studentId: number) {
  return useScopedQuery('feeSummary', ['child', studentId], async () =>
    listOf<PortalFee>((await parentsApi.getChildFees(studentId)).data));
}

export function useChildTimetable(studentId: number) {
  return useScopedQuery('timetable', ['child', studentId], async () =>
    listOf<ChildTimetableRow>((await parentsApi.getChildTimetable(studentId)).data), { staleTime: 5 * 60_000 });
}

export function useChildResults(studentId: number) {
  return useScopedQuery('childResults', [studentId], async () =>
    listOf<PortalResultExam>((await parentsApi.getChildExamResults(studentId)).data), { staleTime: 60_000 });
}

export function useChildExamSchedule(studentId: number) {
  return useScopedQuery('childExamSchedule', [studentId], async () =>
    listOf<ExamScheduleExam>((await parentsApi.getChildExamSchedule(studentId)).data), { staleTime: 5 * 60_000 });
}

export function useChildLibrary(studentId: number) {
  return useScopedQuery('childLibrary', [studentId], async () =>
    listOf<LibraryIssue>((await parentsApi.getChildLibrary(studentId)).data), { staleTime: 60_000 });
}

// The API answers null when the child has no bus.
export function useChildTransport(studentId: number) {
  return useScopedQuery<PortalTransport | null>('childTransport', [studentId], async () =>
    ((await parentsApi.getChildTransport(studentId)).data ?? null) as PortalTransport | null, { staleTime: 5 * 60_000 });
}

// Live position: always fresh, refreshed every 15 s while the screen is open.
export function useBusTracking(studentId: number, enabled: boolean) {
  return useScopedQuery('busTracking', [studentId], async () =>
    (await transportApi.trackStudent(studentId)).data as TrackResponse,
  { enabled, staleTime: 0, refetchInterval: 15_000 });
}

export function useLeaveRequests() {
  return useScopedQuery('parentLeave', [], async () =>
    listOf<ChildLeave>((await parentsApi.getLeaveRequests({ page_size: 200 })).data), { staleTime: 0 });
}

export function useLeaveActions() {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['parentLeave'] });
    qc.invalidateQueries({ queryKey: ['childOverview'] });
  };
  const create = useMutation({ mutationFn: (body: Record<string, unknown>) => parentsApi.createLeaveRequest(body), onSuccess: refresh });
  const cancel = useMutation({ mutationFn: (id: number) => parentsApi.cancelLeaveRequest(id), onSuccess: refresh });
  return { create, cancel };
}
