import { useMutation, useQueryClient } from '@tanstack/react-query';
import { financeApi } from '../services/api';
import { listOf } from '../services/academicYear';
import { suggestionsOf, type CategoryKind, type ManagedAccount, type ManagedCategory } from '../services/financeSetup';
import { useScopedQuery } from './useScopedQuery';

// Money roots (services/queryRules.ts): never persisted, always stale. Accounts and fee categories
// feed balances, fee generation and the expense and income pickers, so every write refreshes them all.
const ROOTS = ['accounts', 'feeCategories', 'categories', 'expenses', 'otherIncome', 'finance'];

// include_inactive is an existing server option (the web gateway page uses it): without it an account that is
// switched off disappears from the list and can never be switched back on.
export function useManagedAccounts() {
  return useScopedQuery('accounts', ['manage'], async () =>
    listOf<ManagedAccount>((await financeApi.getAccounts({ page_size: 9999, include_inactive: true })).data));
}

export function useAccountManageActions() {
  const qc = useQueryClient();
  const done = () => ROOTS.forEach((root) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === root }));
  return {
    create: useMutation({ mutationFn: (d: object) => financeApi.createAccount(d), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => financeApi.updateAccount(id, data), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: number) => financeApi.deleteAccount(id), onSuccess: done }),
  };
}

const list = (kind: CategoryKind) => (kind === 'expense' ? financeApi.getExpenseCategories : kind === 'income' ? financeApi.getIncomeCategories
  : kind === 'monthly' ? financeApi.getMonthlyCategories : financeApi.getAnnualCategories);

export function useManagedCategories(kind: CategoryKind) {
  return useScopedQuery('categories', ['manage', kind], async () => listOf<ManagedCategory>((await list(kind)({ page_size: 9999 })).data));
}

// Only the two fee kinds have a suggestions endpoint.
export function useCategorySuggestions(kind: CategoryKind) {
  return useScopedQuery('categories', ['suggestions', kind], async () =>
    suggestionsOf((await (kind === 'monthly' ? financeApi.getMonthlyCategorySuggestions() : financeApi.getAnnualCategorySuggestions())).data),
  { enabled: kind === 'monthly' || kind === 'annual' });
}

export function useCategoryActions(kind: CategoryKind) {
  const qc = useQueryClient();
  const done = () => ROOTS.forEach((root) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === root }));
  const api = financeApi;
  return {
    create: useMutation({
      mutationFn: (d: object) => (kind === 'expense' ? api.createExpenseCategory(d) : kind === 'income' ? api.createIncomeCategory(d)
        : kind === 'monthly' ? api.createMonthlyCategory(d) : api.createAnnualCategory(d)),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, data }: { id: number; data: object }) => (kind === 'expense' ? api.updateExpenseCategory(id, data)
        : kind === 'income' ? api.updateIncomeCategory(id, data) : kind === 'monthly' ? api.updateMonthlyCategory(id, data) : api.updateAnnualCategory(id, data)),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: number) => (kind === 'expense' ? api.deleteExpenseCategory(id) : kind === 'income' ? api.deleteIncomeCategory(id)
        : kind === 'monthly' ? api.deleteMonthlyCategory(id) : api.deleteAnnualCategory(id)),
      onSuccess: done,
    }),
  };
}
