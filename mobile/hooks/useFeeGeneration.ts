import { useMutation, useQueryClient } from '@tanstack/react-query';
import { financeApi } from '../services/api';
import type { Preview } from '../services/feeGeneration';
import { useScopedQuery } from './useScopedQuery';

// Root 'feePayments' is a money root: never persisted, always stale, refreshed after a write.
export function useGenerationPreview(params: Record<string, unknown>, enabled: boolean) {
  return useScopedQuery('feePayments', ['preview', JSON.stringify(params)], async () =>
    (await financeApi.previewGeneration(params)).data as Preview, { enabled });
}

export function useGenerationActions() {
  const qc = useQueryClient();
  const refresh = () => ['feePayments', 'feeSummary', 'studentFees', 'finance'].forEach((root) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === root }));
  return {
    monthly: useMutation({ mutationFn: (d: object) => financeApi.generateMonthly(d), onSuccess: refresh }),
    annual: useMutation({ mutationFn: (d: object) => financeApi.generateAnnualFees(d), onSuccess: refresh }),
    single: useMutation({ mutationFn: (d: object) => financeApi.generateSingleFee(d), onSuccess: refresh }),
  };
}

// The amount the fee structure gives one student for a category, so it is seen before the record is made.
// Always fetched fresh: a fee changed in Fee setup must show at once.
export function useResolvedFee(student: number | null, kind: 'MONTHLY' | 'ANNUAL', category: number | null, academicYearId?: number | null) {
  return useScopedQuery<{ amount: number | null; source: string | null }>('feePayments', ['resolve', student, kind, category, academicYearId ?? null], async () => {
    const d = (await financeApi.resolveFeeAmount({
      student_id: student, fee_type: kind,
      ...(kind === 'MONTHLY' ? { monthly_category: category } : { annual_category: category }),
      ...(academicYearId ? { academic_year: academicYearId } : {}),
    })).data as { amount?: string | number | null; source?: string | null };
    return { amount: d.amount == null ? null : Number(d.amount), source: d.source ?? null };
  }, { enabled: !!student && !!category, staleTime: 0, retry: false });
}
