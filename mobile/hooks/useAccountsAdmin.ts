import { useMutation, useQueryClient } from '@tanstack/react-query';
import { financeApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { AccountOption, ClosingRow, TransferRow } from '../services/accountsAdmin';
import { useScopedQuery } from './useScopedQuery';

// Money roots (services/queryRules.ts): never persisted, always stale. 'accounts' is refreshed after
// every write because balances move with a transfer and freeze with a closing.
const refresh = (qc: ReturnType<typeof useQueryClient>) =>
  ['accounts', 'finance', 'feePayments', 'expenses', 'otherIncome'].forEach((root) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === root }));

export function useAccountOptions() {
  return useScopedQuery('accounts', ['options'], async () => listOf<AccountOption>((await financeApi.getAccounts({ page_size: 9999 })).data));
}

export function useTransfers(from: string, to: string) {
  return useScopedQuery('accounts', ['transfers', from, to], async () =>
    listOf<TransferRow>((await financeApi.getTransfers({ ...(from ? { date_from: from } : {}), ...(to ? { date_to: to } : {}), page_size: 500 })).data));
}

export function useTransferActions() {
  const qc = useQueryClient();
  const done = () => refresh(qc);
  return {
    create: useMutation({ mutationFn: (d: object) => financeApi.createTransfer(d), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => financeApi.updateTransfer(id, data), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: number) => financeApi.deleteTransfer(id), onSuccess: done }),
  };
}

export function useClosings() {
  return useScopedQuery('accounts', ['closings'], async () => listOf<ClosingRow>((await financeApi.getClosings()).data));
}

export function useCloseMonth() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (d: { year: number; month: number; notes?: string }) => financeApi.closeMonth(d), onSuccess: () => refresh(qc) });
}
