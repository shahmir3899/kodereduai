import { useMutation, useQueryClient } from '@tanstack/react-query';
import { admissionsApi } from '../services/api';
import { listOf } from '../services/academicYear';
import {
  EMPTY_COUNTS, type ConvertResult, type Enquiry, type EnquiryDetail, type LikelihoodResult,
  type ListFilters, type StatusCounts,
} from '../services/admissions';
import { useScopedPagedQuery, useScopedQuery } from './useScopedQuery';

// None of these roots is in the persisted list (services/queryRules.ts): they hold parents' phone
// numbers, so they stay in memory only, and every write needs a connection.

type Page<T> = { results: T[]; next: string | null; count: number };

function pageOf<T>(data: unknown): Page<T> {
  const d = data as { results?: T[]; next?: string | null; count?: number } | T[];
  if (Array.isArray(d)) return { results: d, next: null, count: d.length };
  return { results: d.results ?? [], next: d.next ?? null, count: d.count ?? 0 };
}

export function useEnquiriesPaged(filters: ListFilters, enabled = true) {
  return useScopedPagedQuery<Enquiry>('admissionsEnquiries', ['paged', filters.status, filters.grade, filters.source, filters.search], async (page) =>
    pageOf<Enquiry>((await admissionsApi.getEnquiries({
      page, page_size: 20,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.grade !== null ? { grade_level: filters.grade } : {}),
      ...(filters.source ? { source: filters.source } : {}),
      ...(filters.search ? { search: filters.search } : {}),
    })).data), { enabled });
}

// The follow-up lists are plain arrays, not paged.
export function useFollowups(type: 'today' | 'overdue', enabled = true) {
  return useScopedQuery('admissionsFollowups', [type], async () =>
    listOf<Enquiry>((await admissionsApi.getFollowups(type)).data), { enabled, staleTime: 60_000 });
}

export function useStatusCounts() {
  return useScopedQuery('admissionsCounts', [], async () => {
    const data = (await admissionsApi.getStatusCounts()).data as Partial<StatusCounts>;
    return { ...EMPTY_COUNTS, ...data } as StatusCounts;
  }, { staleTime: 30_000 });
}

export function useEnquiry(id: number | null) {
  return useScopedQuery('admissionsEnquiry', [id], async () =>
    (await admissionsApi.getEnquiry(id as number)).data as EnquiryDetail, { enabled: id !== null, staleTime: 0 });
}

// Cached for five minutes; the screen's refresh button forces a new score run.
export function useConversionLikelihood() {
  return useScopedQuery('admissionsLikelihood', [], async () =>
    (await admissionsApi.getConversionLikelihood()).data as LikelihoodResult, { staleTime: 5 * 60_000 });
}

const ROOTS = ['admissionsEnquiries', 'admissionsEnquiry', 'admissionsCounts', 'admissionsFollowups', 'admissionsLikelihood'];
// A conversion also creates students, enrollments and (optionally) fee records.
const CONVERT_ROOTS = ['students', 'student', 'studentFees', 'feePayments', 'feeSummary', 'adminDashboard', 'session-classes'];

export function useAdmissionsActions() {
  const qc = useQueryClient();
  const invalidate = (roots: string[]) => roots.forEach((root) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === root }));
  const refresh = () => invalidate(ROOTS);

  return {
    createEnquiry: useMutation({ mutationFn: (d: object) => admissionsApi.createEnquiry(d), onSuccess: refresh }),
    updateEnquiry: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => admissionsApi.updateEnquiry(id, data), onSuccess: refresh }),
    deleteEnquiry: useMutation({ mutationFn: (id: number) => admissionsApi.deleteEnquiry(id), onSuccess: refresh }),
    setStatus: useMutation({ mutationFn: ({ id, status, note }: { id: number; status: string; note?: string }) => admissionsApi.updateStatus(id, { status, note }), onSuccess: refresh }),
    addNote: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => admissionsApi.addNote(id, data), onSuccess: refresh }),
    convert: useMutation({
      mutationFn: async (d: object) => (await admissionsApi.batchConvert(d)).data as ConvertResult,
      // A 400 with some failures still created nothing; a 201 with errors created some, so the
      // lists must refresh either way.
      onSettled: () => { refresh(); invalidate(CONVERT_ROOTS); },
    }),
  };
}
