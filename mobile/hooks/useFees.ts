import { useMutation, useQueryClient } from '@tanstack/react-query';
import { financeApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { FeePayment, FeeTypeTab } from '../services/feeCollect';
import { useAcademicYear } from './useAcademicYear';
import { useScopedQuery } from './useScopedQuery';

// Money never comes from a cache: 'feePayments' and 'accounts' are money roots (always stale,
// and refreshed after any mutation), see services/queryRules.ts.
// Teacher scoping is enforced server-side regardless of the params below.
export function useFeePayments(feeType: FeeTypeTab, month: number, year: number) {
  const ay = useAcademicYear({ lockToCurrent: true });
  const yearId = ay.current?.id ?? null;
  const fetchType = async (type: 'MONTHLY' | 'ANNUAL') =>
    listOf<FeePayment>((await financeApi.getFeePayments({
      month: type === 'MONTHLY' ? month : 0, year, fee_type: type, ...(yearId && { academic_year: yearId }), page_size: 9999,
    })).data);

  // "All" is the monthly fees of the month plus the annual ones, as on the web.
  return useScopedQuery('feePayments', [feeType, feeType === 'ANNUAL' ? 0 : month, year, yearId], async () => {
    if (feeType === 'ALL') {
      const [monthly, annual] = await Promise.all([fetchType('MONTHLY'), fetchType('ANNUAL')]);
      return [...monthly, ...annual];
    }
    return fetchType(feeType);
  }, { enabled: !ay.isLoading });
}

export function useAccounts() {
  return useScopedQuery('accounts', [], async () =>
    listOf<{ id: number; name: string; is_active?: boolean }>((await financeApi.getAccounts({ page_size: 9999 })).data));
}

export function useRecordPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => financeApi.recordPayment(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feePayments'] });
      queryClient.invalidateQueries({ queryKey: ['feeSummary'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['adminDashboard'] });
    },
  });
}

export function useDeleteFeePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => financeApi.deleteFeePayment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feePayments'] });
      queryClient.invalidateQueries({ queryKey: ['feeSummary'] });
      queryClient.invalidateQueries({ queryKey: ['adminDashboard'] });
    },
  });
}

// Money roots are refreshed after any change, so no screen shows a balance from before it.
const refreshMoney = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: ['feePayments'] });
  queryClient.invalidateQueries({ queryKey: ['feeSummary'] });
  queryClient.invalidateQueries({ queryKey: ['accounts'] });
  queryClient.invalidateQueries({ queryKey: ['finance'] });
  queryClient.invalidateQueries({ queryKey: ['adminDashboard'] });
};

export function useBulkPayFull() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: object) => financeApi.bulkUpdatePayments(data),
    onSuccess: () => refreshMoney(queryClient),
  });
}

export function useBulkDeleteFees() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => financeApi.bulkDeletePayments({ ids }),
    onSuccess: () => refreshMoney(queryClient),
  });
}
