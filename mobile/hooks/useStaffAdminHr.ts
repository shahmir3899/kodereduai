import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hrApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { LeaveBalance } from '../services/myHr';
import { leaveListParams, type LeaveFilter, type StaffLeaveApplication } from '../services/staffLeave';
import type { ExistingStaffAttendance, StaffForAttendance } from '../services/staffAttendance';
import { useScopedQuery } from './useScopedQuery';

// Names and attendance stay in memory only (none of these roots is persisted). Every write refreshes
// the lists and the dashboard counts that depend on it.
const ROOTS = ['hrLeaveApplications', 'hrLeaveBalance', 'hrStaffAttendance', 'hrDashboard', 'adminDashboard'];
const refresh = (qc: ReturnType<typeof useQueryClient>) => ROOTS.forEach((r) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === r }));

export function useStaffLeaveList(filter: LeaveFilter, term: string) {
  return useScopedQuery('hrLeaveApplications', ['admin', filter, term], async () =>
    listOf<StaffLeaveApplication>((await hrApi.getLeaveApplications(leaveListParams(filter, term))).data), { staleTime: 0 });
}

export function useStaffLeaveBalance(staffId: number | null) {
  return useScopedQuery('hrLeaveBalance', [staffId], async () =>
    listOf<LeaveBalance>((await hrApi.getLeaveBalance(staffId as number)).data), { enabled: staffId != null, staleTime: 0 });
}

export function useStaffLeaveActions() {
  const qc = useQueryClient();
  const onSuccess = () => refresh(qc);
  return {
    approve: useMutation({ mutationFn: ({ id, remarks }: { id: number; remarks: string }) => hrApi.approveLeave(id, { admin_remarks: remarks }), onSuccess }),
    reject: useMutation({ mutationFn: ({ id, remarks }: { id: number; remarks: string }) => hrApi.rejectLeave(id, { admin_remarks: remarks }), onSuccess }),
    cancel: useMutation({ mutationFn: (id: number) => hrApi.cancelLeave(id), onSuccess }),
    apply: useMutation({ mutationFn: (data: Record<string, unknown>) => hrApi.createLeaveApplication(data), onSuccess }),
  };
}

// Every active staff member, as the web's attendance page lists them.
export function useStaffForAttendance() {
  return useScopedQuery('hrStaffAttendance', ['staff'], async () =>
    listOf<StaffForAttendance>((await hrApi.getStaff({ employment_status: 'ACTIVE', page_size: 500 })).data));
}

export function useStaffAttendanceDay(date: string) {
  return useScopedQuery('hrStaffAttendance', ['day', date], async () =>
    listOf<ExistingStaffAttendance>((await hrApi.getStaffAttendance({ date, page_size: 500 })).data), { staleTime: 0 });
}

export function useSaveStaffAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => (await hrApi.bulkMarkAttendance(payload)).data as { created?: number; updated?: number },
    onSuccess: () => refresh(qc),
  });
}
