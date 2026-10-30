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
