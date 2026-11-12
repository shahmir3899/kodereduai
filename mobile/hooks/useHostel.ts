import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hostelApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { AllocationRow, GatePassRow, HostelDashboard, HostelRow, RoomRow } from '../services/hostel';
import { useScopedPagedQuery, useScopedQuery } from './useScopedQuery';

type Page<T> = { results: T[]; next: string | null; count: number };
const asPage = <T,>(data: unknown): Page<T> => {
  if (Array.isArray(data)) return { results: data as T[], next: null, count: data.length };
  const d = data as { results?: T[]; next?: string | null; count?: number };
  return { results: d.results ?? [], next: d.next ?? null, count: d.count ?? 0 };
};

export function useHostelDashboard() {
  return useScopedQuery<HostelDashboard>('hostelDashboard', [], async () => (await hostelApi.getDashboard()).data as HostelDashboard, { staleTime: 0 });
}

export function useHostels() {
  return useScopedQuery<HostelRow[]>('hostels', [], async () => listOf<HostelRow>((await hostelApi.getHostels({ page_size: 500 })).data), { staleTime: 0 });
}

export function useRooms(hostel: number | null, enabled = true) {
  return useScopedQuery<RoomRow[]>('hostelRooms', [hostel], async () => listOf<RoomRow>((await hostelApi.getRooms({ page_size: 500, ...(hostel != null ? { hostel_id: hostel } : {}) })).data),
    { enabled: enabled && (hostel == null || hostel > 0), staleTime: 0 });
}

export function useAllocations(activeOnly: boolean) {
  return useScopedPagedQuery<AllocationRow>('hostelAllocations', ['paged', activeOnly], async (page) =>
    asPage<AllocationRow>((await hostelApi.getAllocations({ page, page_size: 20, ...(activeOnly ? { is_active: 'true' } : {}) })).data));
}

// Allocations that are still in force: a gate pass is made for one of these.
export function useActiveAllocations(enabled: boolean) {
  return useScopedQuery<AllocationRow[]>('hostelAllocations', ['active'], async () => listOf<AllocationRow>((await hostelApi.getAllocations({ is_active: 'true', page_size: 500 })).data), { enabled, staleTime: 0 });
}

export function useGatePasses(status: string) {
  return useScopedPagedQuery<GatePassRow>('hostelGatePasses', ['paged', status], async (page) =>
    asPage<GatePassRow>((await hostelApi.getGatePasses({ page, page_size: 20, ...(status ? { status } : {}) })).data));
}

export interface StudentPick { id: number; label: string; sub?: string }

export function useStudentSearch(term: string) {
  return useScopedQuery<StudentPick[]>('hostelStudents', [term], async () =>
    listOf<{ id: number; name: string; class_name?: string; roll_number?: string | number }>((await hostelApi.searchStudents({ search: term, page_size: 20 })).data)
      .map((s) => ({ id: s.id, label: s.name, sub: [s.class_name, s.roll_number ? `Roll ${s.roll_number}` : ''].filter(Boolean).join('  ·  ') })),
  { enabled: term.length >= 2, staleTime: 0 });
}

const ROOTS = ['hostelDashboard', 'hostels', 'hostelRooms', 'hostelAllocations', 'hostelGatePasses', 'hostel-gate-passes'];

export function useHostelActions() {
  const qc = useQueryClient();
  const done = () => ROOTS.forEach((r) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === r }));
  return {
    createHostel: useMutation({ mutationFn: (d: object) => hostelApi.createHostel(d), onSuccess: done }),
    updateHostel: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => hostelApi.updateHostel(id, data), onSuccess: done }),
    deleteHostel: useMutation({ mutationFn: (id: number) => hostelApi.deleteHostel(id), onSuccess: done }),
    createRoom: useMutation({ mutationFn: (d: object) => hostelApi.createRoom(d), onSuccess: done }),
    updateRoom: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => hostelApi.updateRoom(id, data), onSuccess: done }),
    deleteRoom: useMutation({ mutationFn: (id: number) => hostelApi.deleteRoom(id), onSuccess: done }),
    allocate: useMutation({ mutationFn: (d: object) => hostelApi.createAllocation(d), onSuccess: done }),
    vacate: useMutation({ mutationFn: (id: number) => hostelApi.vacateAllocation(id), onSuccess: done }),
    createPass: useMutation({ mutationFn: (d: object) => hostelApi.createGatePass(d), onSuccess: done }),
    passAction: useMutation({
      mutationFn: ({ id, action, data }: { id: number; action: 'approve' | 'reject' | 'checkout' | 'return'; data?: Record<string, unknown> }) => {
        if (action === 'approve') return hostelApi.approveGatePass(id, data);
        if (action === 'reject') return hostelApi.rejectGatePass(id, data);
        return action === 'checkout' ? hostelApi.checkoutGatePass(id) : hostelApi.returnGatePass(id);
      },
      onSuccess: done,
    }),
  };
}
