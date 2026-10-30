import { useMutation, useQueryClient } from '@tanstack/react-query';
import { financeApi, studentsApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { FeeCategory, FeeKind, FeeStructure } from '../services/feeStructure';
import type { FeeStudent } from '../services/studentFees';
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

// Active students of one master class this year, for the per-student amounts screen. Not a money
// root: names and roll numbers only.
export function useFeeClassStudents(classId: number | null) {
  const { current } = useAcademicYear();
  return useScopedQuery('feeClassStudents', [classId, current?.id ?? null], async () =>
    listOf<FeeStudent>((await studentsApi.getStudents({
      class_id: classId, is_active: true, page_size: 9999, ...(current?.id ? { academic_year: current.id } : {}),
    })).data), { enabled: classId != null && !!current?.id });
}

export function useStudentFeeSave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (d: object) => financeApi.bulkSetStudentFeeStructures(d),
    onSuccess: () => ['feeStructures', 'feePayments', 'feeSummary'].forEach((root) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === root })),
  });
}
