import { useMutation, useQueryClient } from '@tanstack/react-query';
import { discountApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { Discount, Scholarship, StudentDiscount } from '../services/discounts';
import { useScopedPagedQuery, useScopedQuery } from './useScopedQuery';

// Money roots (services/queryRules.ts): never persisted, always stale, refreshed after any write.

export function useDiscounts() {
  return useScopedQuery('discounts', ['list'], async () => listOf<Discount>((await discountApi.getDiscounts({ page_size: 500 })).data));
}

export function useScholarships() {
  return useScopedQuery('scholarships', ['list'], async () => listOf<Scholarship>((await discountApi.getScholarships({ page_size: 500 })).data));
}

export function useStudentDiscountsPaged(status: '' | 'true' | 'false') {
  return useScopedPagedQuery<StudentDiscount>('studentDiscounts', ['paged', status], async (page) => {
    const data = (await discountApi.getStudentDiscounts({ page, page_size: 20, ...(status ? { is_active: status } : {}) })).data as
      { results?: StudentDiscount[]; next?: string | null; count?: number } | StudentDiscount[];
    if (Array.isArray(data)) return { results: data, next: null, count: data.length };
    return { results: data.results ?? [], next: data.next ?? null, count: data.count ?? 0 };
  });
}

export function useDiscountActions() {
  const qc = useQueryClient();
  const refresh = () => ['discounts', 'scholarships', 'studentDiscounts', 'feePayments', 'feeSummary']
    .forEach((root) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === root }));
  return {
    createDiscount: useMutation({ mutationFn: (d: object) => discountApi.createDiscount(d), onSuccess: refresh }),
    updateDiscount: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => discountApi.updateDiscount(id, data), onSuccess: refresh }),
    deleteDiscount: useMutation({ mutationFn: (id: number) => discountApi.deleteDiscount(id), onSuccess: refresh }),
    createScholarship: useMutation({ mutationFn: (d: object) => discountApi.createScholarship(d), onSuccess: refresh }),
    updateScholarship: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => discountApi.updateScholarship(id, data), onSuccess: refresh }),
    deleteScholarship: useMutation({ mutationFn: (id: number) => discountApi.deleteScholarship(id), onSuccess: refresh }),
    assign: useMutation({ mutationFn: (d: object) => discountApi.assignDiscount(d), onSuccess: refresh }),
    bulkAssign: useMutation({ mutationFn: (d: object) => discountApi.bulkAssign(d), onSuccess: refresh }),
    removeAssignment: useMutation({ mutationFn: (id: number) => discountApi.removeStudentDiscount(id), onSuccess: refresh }),
  };
}
