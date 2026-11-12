import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hrApi, usersApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { Department, Designation, HrStats, LeavePolicy, Qualification, StaffDocument, StaffRow } from '../services/hrAdmin';
import { canSearchUsers, type LinkCandidate } from '../services/staffAccounts';
import { useScopedPagedQuery, useScopedQuery } from './useScopedQuery';

// Names, phone numbers and documents stay in memory only (not a persisted root). Every write
// refreshes the lists and the dashboard counts that depend on it.
const ROOTS = ['hrStaffAdmin', 'hrStaffMember', 'staffDirectory', 'hrDepartments', 'hrDesignations', 'hrLeavePolicies', 'hrDocuments', 'hrQualifications', 'hrDashboard'];
const refresh = (qc: ReturnType<typeof useQueryClient>) => ROOTS.forEach((r) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === r }));

export function useStaffPaged(term: string, status: string, department: number | null) {
  return useScopedPagedQuery<StaffRow>('staffDirectory', [term, status, department], async (page) => {
    const params: Record<string, unknown> = { page, page_size: 20 };
    if (term) params.search = term;
    if (status === 'ACTIVE') params.is_active = true;
    else if (status === 'LEFT') params.is_active = false;
    if (department != null) params.department = department;
    const data = (await hrApi.getStaff(params)).data as { results?: StaffRow[]; next?: string | null; count?: number } | StaffRow[];
    if (Array.isArray(data)) return { results: data, next: null, count: data.length };
    return { results: data.results ?? [], next: data.next ?? null, count: data.count ?? 0 };
  });
}

export function useStaffMember(id: number | null) {
  return useScopedQuery('hrStaffMember', [id], async () => (await hrApi.getStaffMember(id as number)).data as StaffRow, { enabled: id != null });
}

export function useNextEmployeeId(enabled: boolean) {
  return useScopedQuery('hrStaffAdmin', ['nextId'], async () => String((await hrApi.getNextEmployeeId()).data?.next_employee_id ?? ''), { enabled, staleTime: 0, gcTime: 0 });
}

export function useStaffPicker() {
  return useScopedQuery('hrStaffAdmin', ['picker'], async () =>
    listOf<StaffRow>((await hrApi.getStaff({ page_size: 9999, is_active: true })).data));
}

export function useDepartments() {
  return useScopedQuery('hrDepartments', ['list'], async () => listOf<Department>((await hrApi.getDepartments({ page_size: 9999 })).data));
}

export function useDesignations() {
  return useScopedQuery('hrDesignations', ['list'], async () => listOf<Designation>((await hrApi.getDesignations({ page_size: 9999 })).data));
}

export function useLeavePolicyList() {
  return useScopedQuery('hrLeavePolicies', ['list'], async () => listOf<LeavePolicy>((await hrApi.getLeavePolicies({ page_size: 9999 })).data));
}

export function useDocuments() {
  return useScopedQuery('hrDocuments', ['list'], async () => listOf<StaffDocument>((await hrApi.getDocuments({ page_size: 9999 })).data));
}

export function useQualifications() {
  return useScopedQuery('hrQualifications', ['list'], async () => listOf<Qualification>((await hrApi.getQualifications({ page_size: 9999 })).data));
}

export function useHrStats() {
  return useScopedQuery('hrDashboard', ['stats'], async () => (await hrApi.getDashboardStats()).data as HrStats);
}

export function useHrActions() {
  const qc = useQueryClient();
  const done = () => refresh(qc);
  const useWrite = <V,>(fn: (v: V) => Promise<unknown>) => useMutation({ mutationFn: fn, onSuccess: done });
  return {
    createStaff: useWrite((d: object) => hrApi.createStaff(d)),
    updateStaff: useWrite(({ id, data }: { id: number; data: object }) => hrApi.updateStaff(id, data)),
    deactivateStaff: useWrite((id: number) => hrApi.deleteStaff(id)),
    reactivateStaff: useWrite((id: number) => hrApi.reactivateStaff(id)),
    createDepartment: useWrite((d: object) => hrApi.createDepartment(d)),
    updateDepartment: useWrite(({ id, data }: { id: number; data: object }) => hrApi.updateDepartment(id, data)),
    deleteDepartment: useWrite((id: number) => hrApi.deleteDepartment(id)),
    createDesignation: useWrite((d: object) => hrApi.createDesignation(d)),
    updateDesignation: useWrite(({ id, data }: { id: number; data: object }) => hrApi.updateDesignation(id, data)),
    deleteDesignation: useWrite((id: number) => hrApi.deleteDesignation(id)),
    createPolicy: useWrite((d: object) => hrApi.createLeavePolicy(d)),
    updatePolicy: useWrite(({ id, data }: { id: number; data: object }) => hrApi.updateLeavePolicy(id, data)),
    deletePolicy: useWrite((id: number) => hrApi.deleteLeavePolicy(id)),
    createQualification: useWrite((d: object) => hrApi.createQualification(d)),
    updateQualification: useWrite(({ id, data }: { id: number; data: object }) => hrApi.updateQualification(id, data)),
    deleteQualification: useWrite((id: number) => hrApi.deleteQualification(id)),
    createDocument: useWrite((f: FormData) => hrApi.createDocument(f)),
    updateDocument: useWrite(({ id, data }: { id: number; data: object }) => hrApi.updateDocument(id, data)),
    deleteDocument: useWrite((id: number) => hrApi.deleteDocument(id)),
  };
}

// Sign-in accounts of staff. A change shows in the staff profile and list, and in Users and roles.
export function useStaffAccountActions() {
  const qc = useQueryClient();
  const done = () => { refresh(qc); qc.invalidateQueries({ predicate: (q) => ['schoolUsers', 'hrStaffMember', 'hrStaffAdmin', 'staffDirectory'].includes(q.queryKey[0] as string) }); };
  return {
    create: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => hrApi.createStaffAccount(id, data), onSuccess: done }),
    link: useMutation({ mutationFn: ({ id, userId }: { id: number; userId: number }) => hrApi.linkStaffAccount(id, { user_id: userId }), onSuccess: done }),
    unlink: useMutation({ mutationFn: (id: number) => hrApi.unlinkStaffAccount(id), onSuccess: done }),
    role: useMutation({ mutationFn: ({ id, role, canManageFinance }: { id: number; role: string; canManageFinance?: boolean }) => hrApi.updateStaffRole(id, { user_role: role, can_manage_finance: role === 'MANAGER' && !!canManageFinance }), onSuccess: done }),
  };
}

export function useBulkLogins() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (d: object) => hrApi.bulkCreateStaffAccounts(d),
    onSuccess: () => { refresh(qc); qc.invalidateQueries({ predicate: (q) => ['schoolUsers', 'hrStaffAdmin', 'staffDirectory'].includes(q.queryKey[0] as string) }); },
  });
}

// Users of the school matching a search, for linking one to a staff member (the web searches from 2 letters).
export function useUserSearch(term: string, enabled: boolean) {
  const t = term.trim();
  return useScopedQuery('schoolUsers', ['search', t], async () =>
    listOf<LinkCandidate>((await usersApi.getUsers({ search: t, page_size: 20 })).data), { enabled: enabled && canSearchUsers(t), staleTime: 0 });
}
