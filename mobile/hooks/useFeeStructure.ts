import { useMutation, useQueryClient } from '@tanstack/react-query';
import { financeApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { FeeCategory, FeeKind, FeeStructure } from '../services/feeStructure';
import { useAcademicYear } from './useAcademicYear';
import { useScopedQuery } from './useScopedQuery';

// Money roots (services/queryRules.ts): never persisted, always stale.

export function useFeeStructures(kind: FeeKind) {
  const { current } = useAcademicYear();
  return useScopedQuery('feeStructures', [kind, current?.id ?? null], async () =>
    listOf<FeeStructure>((await financeApi.getFeeStructures({
      fee_type: kind, page_size: 9999, ...(current?.id ? { academic_year: current.id } : {}),
    })).data), { enabled: !!current?.id });
}

export function useFeeCategories(kind: FeeKind) {
  return useScopedQuery('feeCategories', [kind], async () =>
    listOf<FeeCategory>((await (kind === 'MONTHLY' ? financeApi.getMonthlyCategories({ page_size: 500 }) : financeApi.getAnnualCategories({ page_size: 500 }))).data)
      .filter((c) => c.is_active !== false));
}

export function useFeeStructureActions(kind: FeeKind) {
  const qc = useQueryClient();
  const refresh = () => ['feeStructures', 'feePayments', 'feeSummary'].forEach((root) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === root }));
  return {
    save: useMutation({ mutationFn: (d: object) => financeApi.bulkSetFeeStructures(d), onSuccess: refresh }),
    createCategory: useMutation({
      mutationFn: (d: object) => (kind === 'MONTHLY' ? financeApi.createMonthlyCategory(d) : financeApi.createAnnualCategory(d)),
      onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'feeCategories' }),
    }),
  };
}
