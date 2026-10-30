import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hrApi } from '../services/api';
import { listOf } from '../services/academicYear';
import {
  resolveMyStaffId, type AttendanceSummary, type LeaveApplication, type LeaveBalance, type LeavePolicy,
  type StaffAttendanceRecord,
} from '../services/myHr';
import { useAuth } from '../contexts/AuthContext';
import { useScopedQuery } from './useScopedQuery';
import { useMyTimetable } from './useTeacher';

// The server scopes every list below to the signed-in person's own record.
export function useMyLeaveApplications() {
  return useScopedQuery('hrLeaveApplications', [], async () =>
    listOf<LeaveApplication>((await hrApi.getLeaveApplications({ page_size: 9999 })).data), { staleTime: 0 });
}

export function useLeavePolicies() {
  return useScopedQuery('hrLeavePolicies', [], async () =>
    listOf<LeavePolicy>((await hrApi.getLeavePolicies({ page_size: 9999 })).data), { staleTime: 5 * 60_000 });
}

// Needs the person's own staff id: from their applications, the staff list, or the timetable.
export function useMyLeaveBalance(applications: LeaveApplication[], appsReady: boolean) {
  const { user, isTeacher } = useAuth();
  const staff = useScopedQuery('staff', ['mine'], async () =>
    listOf<{ id: number; user?: number | null }>((await hrApi.getStaff({ page_size: 50 })).data),
  { enabled: appsReady && applications.length === 0, staleTime: 5 * 60_000 });
  const timetable = useMyTimetable();
  const staffId = appsReady ? resolveMyStaffId({
    applications,
    staff: staff.data ?? [],
    userId: user?.id,
    timetableTeacherId: isTeacher ? timetable.data?.find((e) => e.teacher)?.teacher : null,
  }) : null;
  return useScopedQuery('hrLeaveBalance', [staffId], async () =>
    listOf<LeaveBalance>((await hrApi.getLeaveBalance(staffId!)).data), { enabled: !!staffId, staleTime: 0 });
}

export function useLeaveActions() {
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['hrLeaveApplications'] });
    queryClient.invalidateQueries({ queryKey: ['hrLeaveBalance'] });
    queryClient.invalidateQueries({ queryKey: ['hrDashboardStats'] });
  };
  return {
    apply: useMutation({ mutationFn: (data: Record<string, unknown>) => hrApi.createLeaveApplication(data), onSuccess: refresh }),
    cancel: useMutation({ mutationFn: (id: number) => hrApi.cancelLeave(id), onSuccess: refresh }),
  };
}

export function useMyAttendance(start: string, end: string) {
  const records = useScopedQuery('myAttendanceRecords', [start, end], async () =>
    listOf<StaffAttendanceRecord>((await hrApi.getStaffAttendance({ date_from: start, date_to: end, page_size: 100 })).data),
  { staleTime: 0 });
  const summary = useScopedQuery('myAttendanceSummary', [start, end], async () =>
    listOf<AttendanceSummary>((await hrApi.getAttendanceSummary({ date_from: start, date_to: end })).data)[0] ?? null,
  { staleTime: 0 });
  return { records, summary };
}
