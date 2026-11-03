import { useMutation, useQueryClient } from '@tanstack/react-query';
import { financeApi } from '../services/api';
import { listOf } from '../services/academicYear';
import {
  accountsOf, normalizeFeeSummary, type LedgerPayload, type DateRange, type ExpenseCategory, type RecentEntry, type TrendMonth,
} from '../services/accountant';
import type { FeePayment } from '../services/feeCollect';
import { normalizeAllBalances, normalizeAnnualFees } from '../services/financeDashboard';
import { useAcademicYear } from './useAcademicYear';
import { useScopedPagedQuery, useScopedQuery } from './useScopedQuery';

// Read-only finance data for the Accountant. Every root is a money root (services/queryRules.ts),
// so none of it is persisted or served stale.

export function useAccountBalances(enabled = true) {
  return useScopedQuery('accounts', ['balances'], async () =>
    accountsOf((await financeApi.getAccountBalances()).data), { enabled });
}

// One account's running ledger, newest first, capped so a long history stays light.
export function useAccountLedger(accountId: number, from: string, to: string) {
  return useScopedQuery('accounts', ['ledger', accountId, from, to], async () =>
    (await financeApi.getAccountLedger({
      account_id: accountId, ordering: 'desc', limit: 200,
      ...(from ? { date_from: from } : {}), ...(to ? { date_to: to } : {}),
    })).data as LedgerPayload, { enabled: !!accountId });
}

export function useRecentEntries(limit = 8) {
  return useScopedQuery('finance', ['recent', limit], async () =>
    listOf<RecentEntry>((await financeApi.getRecentEntries({ limit })).data));
}

// This month's MONTHLY fees, the same definition every web dashboard uses.
export function useMonthFeeSummary() {
  const { current } = useAcademicYear();
  const now = new Date();
  return useScopedQuery('feeSummary', ['month', now.getMonth() + 1, now.getFullYear(), current?.id ?? null], async () =>
    normalizeFeeSummary((await financeApi.getMonthlySummary({
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      fee_type: 'MONTHLY',
      ...(current?.id ? { academic_year: current.id } : {}),
    })).data));
}

// `range` is null while a custom range is incomplete, which keeps the queries idle.
export function useFinanceSummary(range: DateRange | null) {
  return useScopedQuery('finance', ['summary', range?.from, range?.to], async () =>
    (await financeApi.getFinanceSummary({ date_from: range!.from, date_to: range!.to })).data as {
      total_income?: number | string; total_expenses?: number | string; fee_income?: number | string;
      other_income?: number | string; balance?: number | string;
    }, { enabled: !!range });
}

export function useMonthlyTrend(months = 6) {
  return useScopedQuery('finance', ['trend', months], async () =>
    ((await financeApi.getMonthlyTrend({ months })).data?.trend ?? []) as TrendMonth[]);
}

export function useExpenseCategories(range: DateRange | null) {
  return useScopedQuery('expenses', ['categories', range?.from, range?.to], async () => {
    const data = (await financeApi.getExpenseCategorySummary({ date_from: range!.from, date_to: range!.to })).data as
      { categories?: ExpenseCategory[]; total?: number | string };
    return { categories: data.categories ?? [], total: data.total ?? 0 };
  }, { enabled: !!range });
}

export function useOverdueFees(limit = 8) {
  return useScopedQuery('feePayments', ['unpaid', limit], async () =>
    listOf<FeePayment>((await financeApi.getFeePayments({ status: 'UNPAID', ordering: '-due_date', page_size: limit })).data));
}

// A finance list (fee payments, expenses, other income) as an infinite query.
export function useFinanceList<Item>(
  root: 'feePayments' | 'expenses' | 'otherIncome',
  fetcher: (params: Record<string, unknown>) => Promise<{ data: unknown }>,
  filters: Record<string, unknown>,
) {
  return useScopedPagedQuery<Item>(root, ['list', JSON.stringify(filters)], async (page) => {
    const data = (await fetcher({ page, page_size: 20, ...filters })).data as
      { results?: Item[]; next?: string | null; count?: number } | Item[];
    if (Array.isArray(data)) return { results: data, next: null, count: data.length };
    return { results: data.results ?? [], next: data.next ?? null, count: data.count ?? 0 };
  });
}

// Balances of every school the admin belongs to plus the organisation's shared accounts.
export function useAccountBalancesAll(enabled: boolean) {
  return useScopedQuery('accounts', ['balances-all'], async () =>
    normalizeAllBalances((await financeApi.getAccountBalancesAll()).data), { enabled });
}

// This year's ANNUAL fees (stored with month 0); all schools for a multi-school admin.
export function useAnnualFeeSummary(isMulti: boolean) {
  const { current } = useAcademicYear();
  const year = new Date().getFullYear();
  return useScopedQuery('feeSummary', ['annual', isMulti ? 'all' : 'single', year, current?.id ?? null], async () => {
    const params = { month: 0, year, fee_type: 'ANNUAL' };
    const res = isMulti
      ? await financeApi.getMonthlySummaryAll(params)
      : await financeApi.getMonthlySummary({ ...params, ...(current?.id ? { academic_year: current.id } : {}) });
    return normalizeAnnualFees(res.data, isMulti);
  });
}

export interface TransferRow { id: number; date?: string; amount: number | string; description?: string; from_account_name?: string; to_account_name?: string }

// The five newest transfers (the server orders newest first).
export function useRecentTransfers(limit = 5) {
  return useScopedQuery('accounts', ['transfers-recent', limit], async () =>
    listOf<TransferRow>((await financeApi.getTransfers({ page_size: limit })).data).slice(0, limit));
}

// An account's ten newest ledger lines for the dashboard preview sheet.
export function useLedgerPreview(accountId: number | null, schoolId?: number | null) {
  return useScopedQuery('accounts', ['ledger-preview', accountId, schoolId ?? null], async () =>
    (await financeApi.getAccountLedger({ account_id: accountId, ordering: 'desc', limit: 10 }, schoolId)).data as LedgerPayload,
  { enabled: !!accountId });
}

// Income posts against an account, so removing one changes balances and the finance totals as well.
export function useDeleteOtherIncome() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => financeApi.deleteOtherIncome(id),
    onSuccess: () => {
      for (const key of ['otherIncome', 'accounts', 'finance', 'feeSummary', 'adminDashboard']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
}
